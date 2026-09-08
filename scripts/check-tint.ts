import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, firefox, webkit } from '@playwright/test';
import sharp from 'sharp';
import { build } from 'vite';
import colors from '../src/content/v2/colors.json' with { type: 'json' };
import {
  neutralImages,
  neutralPngBudget,
  prepareNeutralAssets,
} from './lib/neutral-png.ts';
import { serveArtifact } from './lib/static-server.ts';

const project = resolve(import.meta.dirname, '..');
const buildOnly = process.argv.includes('--build-only');
const fixture = await mkdtemp(join(tmpdir(), 'tamchy-tint-check-'));
const evidence = await mkdtemp(join(tmpdir(), 'tamchy-tint-evidence-'));
const results: unknown[] = [];
try {
  const assets = await prepareNeutralAssets(project);
  const images = await Promise.all(
    neutralImages.map(async (entry) => {
      const data = await sharp(resolve(project, entry.source))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const probes: { pixel: number; tone: number; alpha: number }[] = [];
      const seen = new Set<string>();
      for (let offset = 0; offset < data.length; offset += 4) {
        const tone = data[offset]!;
        const alpha = data[offset + 3]!;
        const key = `${Math.floor(tone / 32)}-${Math.floor(alpha / 32)}`;
        if (!seen.has(key)) {
          probes.push({ pixel: offset / 4, tone, alpha });
          seen.add(key);
        }
      }
      return { id: entry.id, path: entry.outputs[0]!, probes };
    }),
  );
  await writeFile(
    join(fixture, 'index.html'),
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Тамчы — проверка PNG</title><link rel="icon" href="data:,"><style>
body{margin:0;padding:24px;background:#FFF9F2;color:#27332F;font:16px system-ui}h1{font-size:24px}nav{display:flex;gap:8px;flex-wrap:wrap}button{padding:12px;border:1px solid #bbb;border-radius:12px;background:white;font:inherit}button[aria-pressed=true]{outline:3px solid #27332F}#grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px;margin-top:24px}figure{margin:0;padding:12px;background:white;border-radius:24px}canvas{display:block;width:100%;height:auto;background:#66746E;border-radius:12px}figcaption{font-size:12px;overflow-wrap:anywhere} @media(max-width:600px){body{padding:16px}#grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><h1>Тамчы — нейтральные PNG</h1><p id="status">Подготовка</p><nav></nav><main id="grid"></main><script type="module" src="/main.js"></script></body></html>`,
  );
  await writeFile(
    join(fixture, 'main.js'),
    `
import { createTintedImageService, drawTintedImage } from ${JSON.stringify(resolve(project, 'src/services/assets/tinted-images.ts'))};
const colors = ${JSON.stringify(colors)};
const images = ${JSON.stringify(images)};
const service = createTintedImageService();
let controller = new AbortController();
const canvases = images.map(image => {
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const caption = document.createElement('figcaption'); caption.textContent = image.id;
  figure.append(canvas, caption); document.querySelector('#grid').append(figure); return canvas;
});
async function show(color) {
  controller.abort(); controller = new AbortController(); const operation = controller;
  document.querySelector('#status').textContent = 'Подготовка';
  for (const [index, image] of images.entries()) {
    const pixels = await service.prepare(image.path, color.hex, operation.signal);
    operation.signal.throwIfAborted(); drawTintedImage(canvases[index], pixels);
  }
  for (const button of document.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.textContent === color.labelTt));
  document.querySelector('#status').textContent = 'Готово: ' + color.hex;
}
for (const color of colors) {
  const button = document.createElement('button'); button.textContent = color.labelTt;
  button.onclick = () => show(color).catch(error => { if (error.name !== 'AbortError') throw error; });
  document.querySelector('nav').append(button);
}
window.qa = {
  async verify() {
    const operation = new AbortController(); let count = 0;
    for (const image of images) for (const color of colors) {
      const pixels = await service.prepare(image.path, color.hex, operation.signal);
      if (pixels.width !== 1024 || pixels.height !== 1024) throw new Error('Размер PNG');
      const rgb = [1,3,5].map(offset => parseInt(color.hex.slice(offset, offset+2),16));
      for (const probe of image.probes) {
        const offset = probe.pixel * 4;
        if (pixels.data[offset+3] !== probe.alpha) throw new Error('Альфа');
        for (let channel=0;channel<3;channel++) {
          const expected = Math.round(probe.tone <= 128 ? rgb[channel]*probe.tone/128 : rgb[channel]+(255-rgb[channel])*(probe.tone-128)/127);
          if (pixels.data[offset+channel] !== expected) throw new Error('RGB: '+image.id+' '+color.hex);
        }
      }
      count++;
    }
    return { combinations: count, cacheBytes: service.cacheBytes() };
  },
  async cancelAndRetry() {
    const isolated = createTintedImageService(); const operation = new AbortController();
    const task = isolated.prepare(images[0].path, '#D94343', operation.signal);
    operation.abort();
    try { await task; throw new Error('Отмена не сработала'); } catch(error) { if(error.name !== 'AbortError') throw error; }
    const retry = await isolated.prepare(images[0].path, '#D94343', new AbortController().signal);
    isolated.dispose(); return retry.data.length;
  }
};
window.addEventListener('pagehide', () => { controller.abort(); service.dispose(); });
await show(colors[0]);
`,
  );
  for (const base of ['/', '/tamchy/']) {
    const dist = join(fixture, base === '/' ? 'root' : 'subpath');
    await build({
      configFile: false,
      root: fixture,
      base,
      publicDir: false,
      logLevel: 'silent',
      build: { outDir: dist, emptyOutDir: true },
    });
    for (const asset of assets) {
      const output = join(dist, asset.path);
      await mkdir(dirname(output), { recursive: true });
      const data = await readFile(join(project, 'public', asset.path));
      assert(data.length <= neutralPngBudget);
      await writeFile(output, data);
    }
    const chunks = (await readdir(join(dist, 'assets'))).filter((name) =>
      name.endsWith('.js'),
    );
    assert(
      chunks.some((name) => name.startsWith('tint.worker-')),
      'Worker не собран',
    );
    const jsGzip = (
      await Promise.all(
        chunks.map(
          async (name) =>
            gzipSync(await readFile(join(dist, 'assets', name))).length,
        ),
      )
    ).reduce((a, b) => a + b, 0);
    assert(jsGzip <= 150 * 1024, 'Проверочный JS превышает бюджет');
    if (buildOnly) {
      const row = { base, jsGzip, chunks, browserChecked: false };
      results.push(row);
      console.log(JSON.stringify(row));
      continue;
    }
    const server = await serveArtifact(dist, base);
    try {
      for (const [name, browserType] of Object.entries({
        chromium,
        webkit,
        firefox,
      })) {
        const browser = await browserType.launch();
        try {
          const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
          });
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error' || message.type() === 'warning')
              errors.push(message.text());
          });
          await page.goto(server.url);
          await page.getByText('Готово: #D94343', { exact: true }).waitFor();
          assert.equal(await page.title(), 'Тамчы — проверка PNG');
          assert.equal(await page.locator('canvas').count(), 12);
          assert.equal(await page.locator('vite-error-overlay').count(), 0);
          const matrix = await page.evaluate<{
            combinations: number;
            cacheBytes: number;
          }>('window.qa.verify()');
          assert.equal(matrix.combinations, 156);
          assert(matrix.cacheBytes <= 24 * 1024 * 1024);
          assert.equal(
            await page.evaluate('window.qa.cancelAndRetry()'),
            1024 * 1024 * 4,
          );
          await page.getByRole('button', { name: 'Ак', exact: true }).click();
          await page.getByText('Готово: #FFFFFF', { exact: true }).waitFor();
          const whitePath = join(
            evidence,
            name + (base === '/' ? '-root' : '-subpath') + '-white.png',
          );
          await page.screenshot({ path: whitePath, fullPage: true });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: 'Кара', exact: true }).click();
          await page.getByText('Готово: #222625', { exact: true }).waitFor();
          const mobilePath = join(
            evidence,
            name + (base === '/' ? '-root' : '-subpath') + '-black-mobile.png',
          );
          await page.screenshot({ path: mobilePath, fullPage: true });
          assert.deepEqual(errors, []);
          const row = {
            browser: name,
            version: browser.version(),
            base,
            url: server.url,
            ...matrix,
            jsGzip,
            whitePath,
            mobilePath,
            errors,
          };
          results.push(row);
          console.log(JSON.stringify(row));
        } finally {
          await browser.close();
        }
      }
      assert(
        server.seen.some((path) => path.startsWith('assets/tint.worker-')),
      );
      assert(!server.seen.some((path) => path.includes('assets-source')));
    } finally {
      await server.close();
    }
  }
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify({ assets, results }, null, 2),
  );
  console.log(`Проверка PNG завершена; свидетельства: ${evidence}`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
