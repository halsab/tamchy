import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readRelease, releaseDirectory, verifyRelease } from './lib/release.ts';
import { serveArtifact } from './lib/static-server.ts';

const base = '/tamchy/';
const directory = releaseDirectory(base);
const reportPath = join(directory, 'release.json');
const report = await readRelease(reportPath);
await verifyRelease(join(directory, 'dist'), report, base);
const server = await serveArtifact(join(directory, 'dist'), base);
try {
  const result = await promisify(execFile)(
    process.execPath,
    ['scripts/check-published.ts', server.url, report.release, reportPath],
    {
      env: {
        ...process.env,
        TAMCHY_PUBLISHED_REPORTS: 'reports/published-local/subpath',
      },
      timeout: 180000,
    },
  );
  console.log(result.stdout);
} finally {
  await server.close();
  await verifyRelease(join(directory, 'dist'), report, base);
}
