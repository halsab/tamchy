import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readRelease, releaseDirectory } from './lib/release.ts';
import { checkPublished } from './lib/published.ts';

const [
  url,
  expectedRelease,
  reportPath = join(releaseDirectory('/tamchy/'), 'release.json'),
] = process.argv.slice(2);
const output = resolve(
  process.env.TAMCHY_PUBLISHED_REPORTS ?? 'reports/published',
);
await mkdir(output, { recursive: true });
try {
  assert(
    url && expectedRelease,
    'Использование: npm run check:published -- <URL с завершающим /> <release> [release.json]',
  );
  const result = await checkPublished(
    url,
    expectedRelease,
    await readRelease(reportPath),
  );
  await writeFile(join(output, 'http.json'), JSON.stringify(result, null, 2));
  assert(result.passed, result.errors.join('\n'));
  const smoke = await promisify(execFile)(
    process.execPath,
    ['tests/published/smoke.ts', url, expectedRelease],
    {
      env: { ...process.env, TAMCHY_PUBLISHED_REPORTS: output },
      timeout: 180000,
    },
  );
  await writeFile(join(output, 'smoke.log'), smoke.stdout + smoke.stderr);
  console.log(
    `HTTP, SHA-256 и браузерный smoke успешны: ${url}, выпуск ${expectedRelease}.`,
  );
} catch (error) {
  await writeFile(
    join(output, 'error.txt'),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
  console.error(error);
}
