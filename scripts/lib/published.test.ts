import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { checkPublished } from './published.ts';
import { sha256, type ReleaseReport } from './release.ts';

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops) await stop();
});
async function fixture(fault?: {
  path: string;
  status?: number;
  body?: string;
  type?: string;
}) {
  const base = '/tamchy/';
  const release = 'a'.repeat(20);
  const bodies: Record<string, [string, string]> = {
    'index.html': [
      '<html><script src="/tamchy/app.js"></script><link href="/tamchy/manifest.webmanifest"></html>',
      'text/html',
    ],
    'manifest.webmanifest': [
      JSON.stringify({ id: base, scope: base, start_url: `${base}#/` }),
      'application/manifest+json',
    ],
    'offline-manifest.json': [
      JSON.stringify({ base, release }),
      'application/json',
    ],
    'sw.js': ['self.addEventListener("install", () => {});', 'text/javascript'],
    'app.js': ['console.log("Тамчы");', 'application/javascript'],
    'voice.mp3': ['ID3-example-for-http-contract-only', 'audio/mpeg'],
    'image.webp': ['RIFF-example-for-http-contract-only', 'image/webp'],
  };
  const report: ReleaseReport = {
    schema: 1,
    base,
    release,
    version: '0.1.0',
    commit: 'b'.repeat(40),
    dirty: false,
    e2e: 'full',
    files: Object.entries(bodies).map(([path, [body]]) => ({
      path,
      bytes: Buffer.byteLength(body),
      sha256: sha256(body),
    })),
    budgets: {
      js: 0,
      css: 0,
      firstScreen: 0,
      complete: 0,
      illustration: 0,
      neutralIllustration: 0,
    },
  };
  const server = createServer((req, res) => {
    const path = req.url!.slice(base.length) || 'index.html';
    const item = bodies[path];
    if (!item) {
      res.writeHead(404).end();
      return;
    }
    const failure = fault?.path === path ? fault : undefined;
    res.writeHead(failure?.status ?? 200, {
      'content-type': failure?.type ?? item[1],
    });
    res.end(failure?.body ?? item[0]);
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  stops.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${base}`;
  return { report, url, release };
}
it('проверяет HTML корневого URL и все файлы отчёта через HTTP', async () => {
  const { url, release, report } = await fixture();
  const result = await checkPublished(url, release, report);
  expect(result.passed).toBe(true);
  expect(result.resources).toHaveLength(report.files.length + 1);
});
it.each(['audio/mpeg', 'audio/mp3'])(
  'принимает MP3 с Content-Type %s и проверенным SHA-256',
  async (type) => {
    const { url, release, report } = await fixture({ path: 'voice.mp3', type });
    const result = await checkPublished(url, release, report);
    expect(result.passed).toBe(true);
    expect(
      result.resources.find((file) => file.path === 'voice.mp3'),
    ).toMatchObject({
      type,
      sha256: report.files.find((file) => file.path === 'voice.mp3')!.sha256,
    });
  },
);
it.each(['voice.mp3', 'image.webp', 'app.js'])(
  'отклоняет HTML вместо %s даже с HTTP 200',
  async (path) => {
    const { url, release, report } = await fixture({
      path,
      body: '<!doctype html><html>fallback</html>',
      type: 'text/html',
    });
    const result = await checkPublished(url, release, report);
    expect(result.passed).toBe(false);
    expect(result.errors.join()).toContain('HTML');
  },
);
it.each([
  { path: 'sw.js', status: 404 },
  { path: 'voice.mp3', body: 'changed audio' },
  { path: 'voice.mp3', type: 'audio/mp3', body: 'changed audio' },
  { path: 'voice.mp3', type: 'audio/wav' },
  { path: 'app.js', type: 'text/plain' },
  { path: 'manifest.webmanifest', body: '{"scope":"/","start_url":"/"}' },
  {
    path: 'offline-manifest.json',
    body: '{"release":"old","base":"/tamchy/"}',
  },
])('сохраняет диагностику контролируемой ошибки $path', async (fault) => {
  const { url, release, report } = await fixture(fault);
  const result = await checkPublished(url, release, report);
  expect(result.passed).toBe(false);
  expect(result.errors.join()).toContain(fault.path);
  expect(result.resources).toHaveLength(report.files.length + 1);
});
it('отклоняет другую базу и ожидаемый выпуск до сетевой проверки', async () => {
  const { url, release, report } = await fixture();
  await expect(
    checkPublished(url.replace('/tamchy/', '/'), release, report),
  ).rejects.toThrow('base');
  await expect(checkPublished(url, 'c'.repeat(20), report)).rejects.toThrow(
    'выпуск',
  );
});
