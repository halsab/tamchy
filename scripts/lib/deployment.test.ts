import { expect, it, vi } from 'vitest';
import { resolveDeployment } from './deployment.ts';

const repository = 'halsab/tamchy';
const commit = 'a'.repeat(40);
function fixture() {
  const run = {
    id: 42,
    workflow_id: 7,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: commit,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  };
  const artifacts = ['github-pages', 'release-manifest'].map((name, index) => ({
    id: 100 + index,
    name,
    expired: false,
    workflow_run: { id: 42, head_sha: commit },
  }));
  const responses: Record<string, unknown> = {
    '/actions/workflows/checks.yml': { id: 7 },
    '/actions/workflows/checks.yml/runs?branch=main&status=success&per_page=100':
      { workflow_runs: [run] },
    '/actions/runs/42': run,
    '/actions/runs/42/artifacts?per_page=100': { artifacts },
    '/git/ref/heads/main': { object: { sha: commit } },
  };
  const get = vi.fn(async (path: string) => {
    const response = responses[path];
    if (!response) throw new Error(`Unexpected request: ${path}`);
    return response;
  });
  return { run, artifacts, responses, get };
}

it('берёт последний успешный запуск main и возвращает точные ID двух артефактов', async () => {
  const s = fixture();
  expect(await resolveDeployment(s.get, repository, '', false)).toEqual({
    runId: '42',
    commit,
    pagesArtifactId: '100',
    reportArtifactId: '101',
  });
});
it('явный run_id не запускает проверки и не подменяется последним запуском', async () => {
  const s = fixture();
  await resolveDeployment(s.get, repository, '42', false);
  expect(s.get.mock.calls.some(([path]) => path.includes('/runs?'))).toBe(
    false,
  );
});
it.each([
  { status: 'in_progress' },
  { conclusion: 'failure' },
  { event: 'pull_request' },
  { head_branch: 'feature' },
  { workflow_id: 8 },
  { head_sha: 'invalid' },
  { repository: { full_name: 'other/repo' } },
  { head_repository: { full_name: 'fork/tamchy' } },
])('отклоняет непроверенный или сторонний источник %j', async (change) => {
  const s = fixture();
  Object.assign(s.run, change);
  await expect(
    resolveDeployment(s.get, repository, '42', false),
  ).rejects.toThrow();
});
it.each(['-1', 'abc', '42\n43'])(
  'отклоняет неверный run_id %s до API',
  async (id) => {
    const s = fixture();
    await expect(
      resolveDeployment(s.get, repository, id, false),
    ).rejects.toThrow();
    expect(s.get).not.toHaveBeenCalled();
  },
);
it.each(['expired', 'missing', 'duplicate', 'foreign'] as const)(
  'отклоняет артефакты %s',
  async (mode) => {
    const s = fixture();
    if (mode === 'expired') s.artifacts[0]!.expired = true;
    if (mode === 'missing') s.artifacts.pop();
    if (mode === 'duplicate') s.artifacts.push({ ...s.artifacts[0]! });
    if (mode === 'foreign')
      s.artifacts[0]!.workflow_run.head_sha = 'b'.repeat(40);
    await expect(
      resolveDeployment(s.get, repository, '42', false),
    ).rejects.toThrow();
  },
);
it('автодеплой пропускает устаревший коммит; ручной допускает выбранный проверенный выпуск', async () => {
  const s = fixture();
  s.responses['/git/ref/heads/main'] = { object: { sha: 'b'.repeat(40) } };
  expect(await resolveDeployment(s.get, repository, '42', true)).toBeNull();
  expect(await resolveDeployment(s.get, repository, '42', false)).toMatchObject(
    { commit },
  );
});
it('не выбирает pull request в качестве последнего успешного выпуска', async () => {
  const s = fixture();
  s.responses[
    '/actions/workflows/checks.yml/runs?branch=main&status=success&per_page=100'
  ] = {
    workflow_runs: [{ ...s.run, id: 50, event: 'pull_request' }, s.run],
  };
  expect(await resolveDeployment(s.get, repository, '', false)).toMatchObject({
    runId: '42',
  });
});
it('сообщает об отсутствии готового выпуска', async () => {
  const s = fixture();
  s.responses[
    '/actions/workflows/checks.yml/runs?branch=main&status=success&per_page=100'
  ] = { workflow_runs: [] };
  await expect(resolveDeployment(s.get, repository, '', false)).rejects.toThrow(
    'успешный',
  );
});

it('автодеплой публикует успешно проверенный текущий main', async () => {
  const s = fixture();
  expect(await resolveDeployment(s.get, repository, '42', true)).toMatchObject({
    runId: '42',
    commit,
  });
});
