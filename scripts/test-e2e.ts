import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createUpdateFixture } from './lib/e2e-update.ts';

function run(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`npm ${args.join(' ')}: ${result.status}`);
}
// Один dist: обе проверки артефакта и браузеры используют ровно эту сборку до смены базы.
for (const base of ['/', '/tamchy/']) {
  const env = { ...process.env, VITE_BASE: base };
  run(['run', 'build'], env);
  run(['run', 'check:assets'], env);
  run(['run', 'check:budgets'], env);
  const updateRoot = await createUpdateFixture(base);
  try {
    run(['exec', 'playwright', 'test', '--', ...process.argv.slice(2)], {
      ...env,
      TAMCHY_UPDATE_DIST: join(updateRoot, 'dist'),
    });
  } finally {
    await rm(updateRoot, { recursive: true, force: true });
  }
}
