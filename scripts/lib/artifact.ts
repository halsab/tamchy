import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { z } from 'zod';
import { renderOfflineWorker } from './pwa.ts';
import { readContent } from './read-content.ts';
import {
  assertCompleteContent,
  inspectResources,
  resourcePaths,
} from './resources.ts';
import { assertAppBase } from '../../src/services/assets/paths.ts';

const entrySchema = z.object({
  url: z.string(),
  revision: z.string().nullable(),
  integrity: z.string(),
});
export const metadataSchema = z.object({
  base: z.string(),
  release: z.string(),
  cachePrefix: z.string(),
  entries: z.array(entrySchema),
});
export function readPrecache(code: string) {
  const source = ts.createSourceFile(
    'sw.js',
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  let result: z.infer<typeof entrySchema>[] | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'precacheAndRoute'
    ) {
      const array = node.arguments[0];
      assert(
        array && ts.isArrayLiteralExpression(array),
        'precache должен быть массивом',
      );
      result = array.elements.map((element) => {
        assert(ts.isObjectLiteralExpression(element));
        const object: Record<string, string | null> = {};
        for (const property of element.properties) {
          assert(ts.isPropertyAssignment(property));
          const value = property.initializer;
          assert(
            ts.isStringLiteral(value) ||
              value.kind === ts.SyntaxKind.NullKeyword,
          );
          object[property.name.getText(source).replaceAll('"', '')] =
            ts.isStringLiteral(value) ? value.text : null;
        }
        return entrySchema.parse(object);
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(result?.length, 'precacheAndRoute отсутствует');
  return result;
}
export async function inspectArtifact(
  root = process.cwd(),
  base = process.env.VITE_BASE ?? '/',
) {
  assertAppBase(base);
  const dist = resolve(root, 'dist');
  const { catalog } = await readContent(root);
  assertCompleteContent(await inspectResources(dist, catalog));
  const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      assert(entry.isFile(), `Недопустимый файл: ${entry.name}`);
      return resolve(entry.parentPath, entry.name).slice(dist.length + 1);
    })
    .sort();
  const paths = resourcePaths(catalog);
  const required = Object.values(paths).flat();
  const rawMetadata: unknown = JSON.parse(
    await readFile(resolve(dist, 'offline-manifest.json'), 'utf8'),
  );
  const metadata = metadataSchema.parse(rawMetadata);
  assert.equal(
    await readFile(
      resolve(dist, `offline-worker-${metadata.release}.js`),
      'utf8',
    ),
    await renderOfflineWorker(root, rawMetadata),
    'Проверяющий worker изменён',
  );
  assert.equal(metadata.base, base);
  assert.equal(
    metadata.cachePrefix,
    `tamchy-${createHash('sha256').update(base).digest('hex').slice(0, 12)}`,
  );
  const support = [
    'sw.js',
    'offline-manifest.json',
    `offline-worker-${metadata.release}.js`,
    ...files.filter((file) => /^workbox-[a-f0-9]+\.js$/.test(file)),
  ];
  const appFiles = [
    'index.html',
    'manifest.webmanifest',
    ...required,
    ...files.filter((file) => /^assets\/[^/]+\.(js|css|woff2)$/.test(file)),
    ...files.filter((file) => file === 'assets/nunito-OFL.txt'),
  ].sort();
  assert.deepEqual(
    files,
    [...support, ...appFiles].sort(),
    'Посторонние или запрещённые файлы в dist',
  );
  const sw = await readFile(resolve(dist, 'sw.js'), 'utf8');
  const entries = readPrecache(sw);
  assert.deepEqual(
    entries.map((entry) => entry.url).sort(),
    appFiles,
    'Состав precache не совпадает с dist',
  );
  assert.deepEqual(
    entries,
    metadata.entries,
    'Проверяющий worker и generateSW должны читать один перечень',
  );
  assert(
    sw.includes(metadata.cachePrefix) &&
      sw.includes(`offline-worker-${metadata.release}.js`),
  );
  for (const entry of entries) {
    assert(
      !/(^\/|\.\.|:|^(public|dist|assets-source)\/|\.gitkeep)/.test(entry.url),
      `Недопустимый путь: ${entry.url}`,
    );
    const bytes = await readFile(resolve(dist, entry.url));
    assert.equal(
      entry.integrity,
      `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
      entry.url,
    );
    if (required.includes(entry.url) || entry.revision !== null)
      assert.equal(
        entry.revision,
        createHash('md5').update(bytes).digest('hex'),
        `Ревизия: ${entry.url}`,
      );
    if (required.includes(entry.url))
      assert.deepEqual(
        bytes,
        await readFile(resolve(root, 'public', entry.url)),
        `Ресурс изменён: ${entry.url}`,
      );
  }
  const manifest = JSON.parse(
    await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'),
  ) as Record<string, unknown>;
  for (const [key, value] of Object.entries({
    id: base,
    name: 'Тамчы',
    short_name: 'Тамчы',
    lang: 'tt',
    display: 'standalone',
    scope: base,
    start_url: `${base}#/`,
    theme_color: '#FFF9F2',
    background_color: '#FFF9F2',
  }))
    assert.equal(manifest[key], value, key);
  assert(!('orientation' in manifest));
  assert.deepEqual(manifest.icons, [
    { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    {
      src: 'icons/pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ]);
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  assert(
    html.includes(`href="${base}icons/apple-touch-icon.png"`) &&
      html.includes(`href="${base}manifest.webmanifest"`),
  );
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert(match[1]?.startsWith(base), `HTML вне base: ${match[1]}`);
    assert(files.includes(match[1]!.slice(base.length)), `HTML: ${match[1]}`);
  }
  return { dist, files, metadata, catalog };
}
const budgets = {
  js: 150 * 1024,
  css: 20 * 1024,
  firstScreen: 750 * 1024,
  complete: 8 * 1024 * 1024,
  illustration: 150 * 1024,
  neutralIllustration: 300 * 1024,
};
export function assertBudgets(sizes: Record<keyof typeof budgets, number>) {
  for (const key of Object.keys(budgets) as (keyof typeof budgets)[])
    assert(
      sizes[key] <= budgets[key],
      `${key}: ${sizes[key]} > ${budgets[key]} байт`,
    );
}
export async function measureBudgets(
  artifact: Awaited<ReturnType<typeof inspectArtifact>>,
) {
  const { dist, files, catalog } = artifact;
  const sizes = {
    js: 0,
    css: 0,
    firstScreen: 0,
    complete: 0,
    illustration: 0,
    neutralIllustration: 0,
  };
  const firstImages = new Set(
    catalog.categories.map((category) => category.image),
  );
  for (const file of files) {
    const bytes = await readFile(resolve(dist, file));
    sizes.complete += bytes.length;
    const js = /^assets\/.*\.js$/.test(file);
    const css = file.endsWith('.css');
    if (js) sizes.js += gzipSync(bytes).length;
    if (css) sizes.css += gzipSync(bytes).length;
    if (/\.(webp|png|svg)$/.test(file)) {
      const key = /^assets\/images\/(?:shapes|color-objects)\/.+\.png$/.test(
        file,
      )
        ? 'neutralIllustration'
        : 'illustration';
      sizes[key] = Math.max(sizes[key], bytes.length);
    }
    if (js || css || file === 'index.html' || file === 'manifest.webmanifest')
      sizes.firstScreen += gzipSync(bytes).length;
    if (
      firstImages.has(file) ||
      file.startsWith('icons/') ||
      file.endsWith('.woff2')
    )
      sizes.firstScreen += bytes.length;
  }
  assertBudgets(sizes);
  return sizes;
}
