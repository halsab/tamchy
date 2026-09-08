import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { resolveDeployment } from './lib/deployment.ts';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
assert(
  repository && /^[\w.-]+\/[\w.-]+$/.test(repository),
  'Не задан репозиторий',
);
assert(token, 'Не задан токен GitHub Actions');
const selected = await resolveDeployment(
  async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    assert(response.ok, `GitHub API: HTTP ${response.status} для ${path}`);
    return response.json();
  },
  repository,
  process.env.SOURCE_RUN_ID ?? '',
  process.env.AUTOMATIC_DEPLOY === 'true',
);
if (process.env.GITHUB_OUTPUT) {
  const outputs = selected
    ? { deploy: 'true', ...selected }
    : { deploy: 'false' };
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
}
console.log(
  selected
    ? `Готовый выпуск: запуск ${selected.runId}, коммит ${selected.commit}`
    : 'Устаревший push: публикация пропущена, main уже изменился.',
);
