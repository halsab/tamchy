import project from './package.json' with { type: 'json' };
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { contentPlugin } from './scripts/lib/content-plugin.ts';
import { createPwaOptions } from './scripts/lib/pwa.ts';
import { readContent } from './scripts/lib/read-content.ts';
import { resourcePaths } from './scripts/lib/resources.ts';

export default defineConfig(async ({ mode, command }) => {
  const base = process.env.VITE_BASE ?? '/';
  const root = process.cwd();
  const pwa =
    command === 'build' && mode !== 'check'
      ? await createPwaOptions(
          root,
          base,
          project.version,
          Object.values(
            resourcePaths((await readContent(root)).catalog),
          ).flat(),
        )
      : null;
  const pwaPlugins = pwa ? VitePWA(pwa.options) : [];
  return {
    base,
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(project.version),
      'import.meta.env.VITE_APP_RELEASE': JSON.stringify(pwa?.release ?? ''),
    },
    plugins: [
      react(),
      contentPlugin(mode === 'check'),
      ...pwaPlugins,
      {
        name: 'tamchy-precache-files',
        generateBundle() {
          // Манифест уже проверяется через glob итогового dist; исключаем дубликат плагина.
          pwaPlugins
            .find((plugin) => plugin.api)
            ?.api.extendManifestEntries(() => []);
        },
      },
    ],
    build: {
      outDir: mode === 'check' ? '.build-check' : 'dist',
      target: ['safari17', 'chrome111', 'firefox114'],
      cssTarget: ['safari17', 'chrome111', 'firefox114'],
      copyPublicDir: false,
    },
  };
});
