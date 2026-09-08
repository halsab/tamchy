import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLegacyFixture, createUpdateFixture } from './lib/e2e-update.ts';
import {
  captureRelease,
  preserveRelease,
  releaseDirectory,
  verifyRelease,
} from './lib/release.ts';

function run(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`npm ${args.join(' ')}: ${result.status}`);
}
await rm('.release', { recursive: true, force: true });
// Хеши фиксируются до тестов; сохранённая сборка Pages больше не пересобирается.
const base = '/tamchy/';
const env = { ...process.env, VITE_BASE: base };
run(['run', 'build'], env);
run(['run', 'check:assets'], env);
run(['run', 'check:budgets'], env);
const report = await captureRelease(base);
const updateRoot = await createUpdateFixture(base);
let legacyRoot: string | undefined;
try {
  legacyRoot = await createLegacyFixture(base);
  run(['exec', 'playwright', 'test', '--', ...process.argv.slice(2)], {
    ...env,
    TAMCHY_UPDATE_DIST: join(updateRoot, 'dist'),
    TAMCHY_MVP_DIST: join(legacyRoot, 'dist'),
  });
  await verifyRelease('dist', report, base, undefined, false);
  report.e2e = process.argv.length > 2 ? 'filtered' : 'full';
  await preserveRelease('dist', releaseDirectory(base), report);
} finally {
  await rm(updateRoot, { recursive: true, force: true });
  if (legacyRoot) await rm(legacyRoot, { recursive: true, force: true });
}
