import assert from 'node:assert/strict';
import { extname } from 'node:path';
import { releaseSchema, sha256, type ReleaseReport } from './release.ts';
import { mimeTypes } from './static-server.ts';

export async function checkPublished(
  address: string,
  expectedRelease: string,
  input: ReleaseReport,
) {
  const report = releaseSchema.parse(input);
  const root = new URL(address);
  assert(
    ['https:', 'http:'].includes(root.protocol) &&
      !root.username &&
      !root.password &&
      !root.search &&
      !root.hash,
    'Нужен HTTP(S)-адрес приложения без query/hash',
  );
  assert.equal(root.pathname, report.base, 'URL не соответствует base отчёта');
  assert.equal(
    expectedRelease,
    report.release,
    'Ожидаемый выпуск не соответствует проверенному отчёту',
  );
  assert.equal(report.e2e, 'full', 'Нужен полный проверенный артефакт');
  const errors: string[] = [];
  const resources: {
    path: string;
    url: string;
    status?: number;
    type?: string;
    sha256?: string;
    error?: string;
  }[] = [];
  const bodies = new Map<string, string>();
  const index = report.files.find((file) => file.path === 'index.html');
  assert(index, 'Нет index.html в отчёте');
  for (const file of [{ ...index, path: '' }, ...report.files]) {
    const url = new URL(file.path, root).href;
    const result: (typeof resources)[number] = {
      path: file.path || '(главный URL)',
      url,
    };
    resources.push(result);
    try {
      const response = await fetch(url, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      result.status = response.status;
      assert.equal(response.status, 200, `HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const type =
        response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      result.type = type;
      const extension = extname(file.path || 'index.html');
      if (extension !== '.html')
        assert(
          !type.includes('html') &&
            !/^\s*(?:<!doctype html|<html)/i.test(bytes.toString('utf8')),
          'HTML вместо ресурса',
        );
      const allowed =
        extension === '.js'
          ? ['text/javascript', 'application/javascript']
          : extension === '.webmanifest'
            ? ['application/manifest+json', 'application/json']
            : extension === '.mp3'
              ? ['audio/mpeg', 'audio/mp3']
              : [mimeTypes[extension]];
      assert(allowed.includes(type), `Неверный Content-Type: ${type}`);
      result.sha256 = sha256(bytes);
      assert.equal(
        result.sha256,
        file.sha256,
        'SHA-256 не соответствует артефакту',
      );
      assert.equal(
        bytes.length,
        file.bytes,
        'Размер не соответствует артефакту',
      );
      bodies.set(file.path, bytes.toString('utf8'));
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      errors.push(`${result.path}: ${result.error}`);
    }
  }
  try {
    const manifest = JSON.parse(
      bodies.get('manifest.webmanifest') ?? '{}',
    ) as Record<string, unknown>;
    for (const key of ['id', 'scope'])
      assert.equal(manifest[key], report.base, `manifest.webmanifest: ${key}`);
    assert.equal(
      manifest.start_url,
      `${report.base}#/`,
      'manifest.webmanifest: start_url',
    );
    const metadata = JSON.parse(
      bodies.get('offline-manifest.json') ?? '{}',
    ) as Record<string, unknown>;
    assert.equal(
      metadata.release,
      expectedRelease,
      'offline-manifest.json: выпуск',
    );
    assert.equal(metadata.base, report.base, 'offline-manifest.json: base');
    assert(bodies.has('sw.js'), 'sw.js недоступен');
    for (const match of bodies
      .get('index.html')!
      .matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert(match[1]?.startsWith(report.base), `index.html: base ${match[1]}`);
      const url = new URL(match[1]!, root);
      assert.equal(url.origin, root.origin, 'index.html: внешний URL');
      assert(
        report.files.some((file) => new URL(file.path, root).href === url.href),
        `index.html: неизвестный ресурс ${match[1]}`,
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    url: root.href,
    expectedRelease,
    commit: report.commit,
    checkedAt: new Date().toISOString(),
    passed: errors.length === 0,
    resources,
    errors,
  };
}
