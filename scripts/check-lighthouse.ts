import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release as osRelease, arch, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import lighthouse, { generateReport } from 'lighthouse';
import {
  readRelease,
  releaseDirectory,
  sha256,
  verifyRelease,
} from './lib/release.ts';
import { serveArtifact } from './lib/static-server.ts';
import { summarizeMetrics, type Metrics } from './lib/lighthouse.ts';

const config: NonNullable<Parameters<typeof lighthouse>[2]> = {
  extends: 'lighthouse:default',
  settings: {
    onlyCategories: ['performance'],
    locale: 'en-US',
    formFactor: 'mobile',
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false,
    },
    emulatedUserAgent:
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    throttlingMethod: 'simulate',
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      requestLatencyMs: 562.5,
      downloadThroughputKbps: 1474.56,
      uploadThroughputKbps: 675,
      cpuSlowdownMultiplier: 4,
    },
    disableStorageReset: false,
  },
};
await mkdir('reports', { recursive: true });
const base = '/tamchy/';
const directory = releaseDirectory(base);
const report = await readRelease(join(directory, 'release.json'));
const dist = join(directory, 'dist');
await verifyRelease(dist, report, base);
const output = await mkdtemp(resolve('reports/lighthouse-subpath-'));
const metrics: Metrics[] = [];
const runs: unknown[] = [];
const errors: string[] = [];
const server = await serveArtifact(dist, base);
try {
  for (let index = 1; index <= 3; index++) {
    const profile = await mkdtemp(join(tmpdir(), 'tamchy-lighthouse-'));
    try {
      const context = await chromium.launchPersistentContext(profile, {
        headless: true,
        args: ['--remote-debugging-port=0'],
        viewport: null,
      });
      try {
        const port = Number(
          (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(
            '\n',
          )[0],
        );
        server.seen.length = 0;
        console.log(`Lighthouse ${base}: холодный прогон ${index}/3`);
        const result = await lighthouse(
          server.url,
          { port, logLevel: 'error' },
          config,
        );
        assert(result, 'Lighthouse не вернул отчёт');
        await writeFile(
          join(output, `${index}.json`),
          JSON.stringify(result.lhr, null, 2),
        );
        await writeFile(
          join(output, `${index}.html`),
          generateReport(result.lhr, 'html'),
        );
        const evidence = {
          browser: context.browser()!.version(),
          lighthouse: result.lhr.lighthouseVersion,
          settings: result.lhr.configSettings,
          environment: result.lhr.environment,
          requests: [...server.seen],
        };
        runs.push(evidence);
        await writeFile(
          join(output, `${index}-environment.json`),
          JSON.stringify(evidence, null, 2),
        );
        assert(
          !result.lhr.runtimeError,
          JSON.stringify(result.lhr.runtimeError),
        );
        assert(
          server.seen.includes('sw.js') &&
            server.seen.some((path) => path.endsWith('.mp3')),
          'Не наблюдалась настоящая фоновая подготовка PWA',
        );
        metrics.push({
          lcp: result.lhr.audits['largest-contentful-paint']!.numericValue!,
          cls: result.lhr.audits['cumulative-layout-shift']!.numericValue!,
        });
      } finally {
        await context.close();
      }
    } catch (error) {
      errors.push(`Прогон ${index}: ${String(error)}`);
      await writeFile(
        join(output, `${index}-error.txt`),
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
  let median: ReturnType<typeof summarizeMetrics> | null = null;
  try {
    median = summarizeMetrics(metrics);
  } catch (error) {
    errors.push(String(error));
  }
  const passed = errors.length === 0 && median?.passed === true;
  const summary = {
    base,
    url: server.url,
    release: report.release,
    commit: report.commit,
    dirty: report.dirty,
    artifactReportSha256: sha256(
      await readFile(join(directory, 'release.json')),
    ),
    host: {
      platform: platform(),
      os: osRelease(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      node: process.version,
    },
    profile: config.settings,
    metrics,
    median,
    passed,
    errors,
    runs,
  };
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    JSON.stringify(
      { base, metrics, median, passed, errors, reports: output },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await server.close();
  await verifyRelease(dist, report, base);
}
