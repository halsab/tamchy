import assert from 'node:assert/strict';

type Run = {
  id: number;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
  head_sha: string;
  repository: { full_name: string };
  head_repository: { full_name: string } | null;
};
type Artifact = {
  id: number;
  name: string;
  expired: boolean;
  workflow_run: { id: number; head_sha: string };
};

function artifactId(run: Run, artifacts: Artifact[], name: string) {
  const matches = artifacts.filter((artifact) => artifact.name === name);
  assert.equal(matches.length, 1, `Нужен ровно один артефакт ${name}`);
  const artifact = matches[0]!;
  assert(
    !artifact.expired,
    `Истёк срок хранения ${name}; нужен новый запуск проверок`,
  );
  assert.equal(artifact.workflow_run.id, run.id, 'Артефакт другого запуска');
  assert.equal(
    artifact.workflow_run.head_sha,
    run.head_sha,
    'Артефакт другого коммита',
  );
  assert(
    Number.isSafeInteger(artifact.id) && artifact.id > 0,
    'Неверный ID артефакта',
  );
  return String(artifact.id);
}

function checksOnly(run: Run, artifacts: Artifact[]) {
  if (!artifacts.some((artifact) => artifact.name === 'checks-only'))
    return false;
  artifactId(run, artifacts, 'checks-only');
  assert(
    !artifacts.some((artifact) =>
      ['github-pages', 'release-manifest'].includes(artifact.name),
    ),
    'Проверка без выпуска содержит релизные артефакты',
  );
  return true;
}

export async function resolveDeployment(
  get: (path: string) => Promise<unknown>,
  repository: string,
  runId: string,
  automatic: boolean,
) {
  assert(
    !runId || (/^[1-9]\d*$/.test(runId) && Number.isSafeInteger(Number(runId))),
    'Неверный ID запуска',
  );
  const workflow = (await get('/actions/workflows/checks.yml')) as {
    id: number;
  };
  const eligible = (run: Run) =>
    run.workflow_id === workflow.id &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    ['push', 'workflow_dispatch'].includes(run.event) &&
    run.head_branch === 'main' &&
    run.repository.full_name === repository &&
    run.head_repository?.full_name === repository;
  if (!runId) {
    const response = (await get(
      '/actions/workflows/checks.yml/runs?branch=main&status=success&per_page=100',
    )) as { workflow_runs: Run[] };
    let latest: Run | undefined;
    for (const candidate of response.workflow_runs.filter(eligible)) {
      const { artifacts } = (await get(
        `/actions/runs/${candidate.id}/artifacts?per_page=100`,
      )) as { artifacts: Artifact[] };
      if (!checksOnly(candidate, artifacts)) {
        latest = candidate;
        break;
      }
    }
    assert(
      latest,
      'Не найден успешный запуск проверок main; укажите ID готового запуска',
    );
    runId = String(latest.id);
  }
  const run = (await get(`/actions/runs/${runId}`)) as Run;
  assert.equal(String(run.id), runId, 'Другой запуск');
  assert(
    eligible(run),
    'Нужен успешный запуск checks.yml из main этого репозитория',
  );
  assert(/^[a-f0-9]{40}$/.test(run.head_sha), 'Неверный SHA коммита');
  if (automatic) {
    const main = (await get('/git/ref/heads/main')) as {
      object: { sha: string };
    };
    // Завершившийся старый запуск не должен откатить более новый push.
    if (main.object.sha !== run.head_sha) return null;
  }
  const response = (await get(
    `/actions/runs/${runId}/artifacts?per_page=100`,
  )) as { artifacts: Artifact[] };
  if (checksOnly(run, response.artifacts)) {
    assert(automatic, 'Этот запуск не создавал нового выпуска');
    return null;
  }
  return {
    runId,
    commit: run.head_sha,
    pagesArtifactId: artifactId(run, response.artifacts, 'github-pages'),
    reportArtifactId: artifactId(run, response.artifacts, 'release-manifest'),
  };
}
