import { spawnSync } from 'node:child_process';

// Один каталог артефакта: следующая база собирается только после остановки предыдущего preview.
for (const base of ['/', '/tamchy/']) {
  const env = { ...process.env, VITE_BASE: base };
  for (const args of [
    ['run', 'build'],
    ['exec', 'playwright', 'test', '--', ...process.argv.slice(2)],
  ]) {
    const result = spawnSync('npm', args, { env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
