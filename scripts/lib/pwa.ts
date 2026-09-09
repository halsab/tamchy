import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { assertAppBase } from '../../src/services/assets/paths.ts';

export async function createPwaOptions(
  root: string,
  base: string,
  version: string,
  resources: string[],
) {
  assertAppBase(base);
  const hash = createHash('sha256').update(JSON.stringify({ base, version }));
  const sources = (
    await readdir(resolve(root, 'src'), {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((file) => file.isFile() && !/\.test\./.test(file.name))
    .map((file) => resolve(file.parentPath, file.name).slice(root.length + 1));
  for (const file of [
    ...sources,
    ...resources.map((path) => `public/${path}`),
  ].sort()) {
    hash.update(file).update(await readFile(resolve(root, file)));
  }
  for (const file of [
    'package-lock.json',
    'vite.config.ts',
    'scripts/lib/pwa.ts',
  ]) {
    try {
      hash.update(file).update(await readFile(resolve(root, file)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const release = hash.digest('hex').slice(0, 20);
  const cachePrefix = `tamchy-${createHash('sha256').update(base).digest('hex').slice(0, 12)}`;
  const helper = `offline-worker-${release}.js`;
  const options: Partial<VitePWAOptions> = {
    strategies: 'generateSW',
    registerType: 'prompt',
    injectRegister: false,
    base,
    scope: base,
    includeAssets: [],
    includeManifestIcons: false,
    manifest: {
      id: base,
      name: 'Тамчы',
      short_name: 'Тамчы',
      lang: 'tt',
      dir: 'ltr',
      start_url: `${base}#/`,
      scope: base,
      display: 'standalone',
      background_color: '#FFF9F2',
      theme_color: '#FFF9F2',
      icons: [
        { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        {
          src: 'icons/pwa-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      dontCacheBustURLsMatching: /^assets\/[^/]+-[\w-]{8}\.(?:js|css)$/,
      cacheId: cachePrefix,
      skipWaiting: false,
      clientsClaim: false,
      cleanupOutdatedCaches: false,
      sourcemap: false,
      globPatterns: [
        '**/*.{html,js,css,json,webmanifest,png,svg,webp,mp3,woff2,txt}',
      ],
      globIgnores: ['offline-worker-*.js', 'offline-manifest.json'],
      importScripts: [helper],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [
        new RegExp(
          `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:index\\.html)?$`,
        ),
      ],
      manifestTransforms: [
        async (entries) => {
          const manifest = await Promise.all(
            entries.map(async (entry) => ({
              ...entry,
              integrity: `sha256-${createHash('sha256')
                .update(await readFile(resolve(root, 'dist', entry.url)))
                .digest('base64')}`,
            })),
          );
          manifest.sort((a, b) => a.url.localeCompare(b.url));
          const metadata = { base, release, cachePrefix, entries: manifest };
          await writeFile(
            resolve(root, 'dist/offline-manifest.json'),
            JSON.stringify(metadata, null, 2),
          );
          await writeFile(
            resolve(root, 'dist', helper),
            await renderOfflineWorker(root, metadata),
          );
          return { manifest, warnings: [] };
        },
      ],
    },
  };
  return { release, options };
}

export async function renderOfflineWorker(root: string, metadata: unknown) {
  const worker = await readFile(
    resolve(root, 'src/services/pwa/worker.ts'),
    'utf8',
  );
  const code = stripTypeScriptTypes(worker.replace(/export /g, ''), {
    mode: 'strip',
  });
  return `${code}\ninstallOfflineWorker(self, ${JSON.stringify(metadata)});\n`;
}
