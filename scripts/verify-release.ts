import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readRelease,
  releaseDirectory,
  sha256,
  verifyRelease,
} from './lib/release.ts';

const directory = process.argv[2] ?? releaseDirectory('/tamchy/');
const reportPath = join(directory, 'release.json');
const digest = sha256(await readFile(reportPath));
if (process.env.TAMCHY_REPORT_SHA256)
  assert.equal(
    digest,
    process.env.TAMCHY_REPORT_SHA256,
    'Изменён отчёт при передаче',
  );
const report = await readRelease(reportPath);
await verifyRelease(
  join(directory, 'dist'),
  report,
  '/tamchy/',
  process.env.GITHUB_SHA,
);
console.log(
  `Проверен выпуск ${report.release}, commit ${report.commit}, ${report.files.length} файлов, отчёт SHA-256 ${digest}.`,
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `release=${report.release}\nreport_sha256=${digest}\n`,
  );
