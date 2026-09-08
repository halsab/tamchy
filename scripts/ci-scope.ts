import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { classifyChanges } from './lib/ci-scope.ts';

let scope: ReturnType<typeof classifyChanges> = 'app';
if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
  try {
    const event = JSON.parse(
      await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'),
    ) as {
      before?: string;
      pull_request?: { base: { sha: string } };
    };
    const base = event.pull_request?.base.sha ?? event.before;
    if (base && /^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)) {
      const paths = execFileSync(
        'git',
        ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
        { encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean);
      scope = classifyChanges(paths);
    }
  } catch {
    // При неизвестном diff безопасно выполнить полную приёмку.
  }
}
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `kind=${scope}\n`);
if (scope !== 'app')
  await writeFile(
    'checks-only.json',
    JSON.stringify({ commit: process.env.GITHUB_SHA, scope }) + '\n',
  );
console.log(`Проверки: ${scope}`);
