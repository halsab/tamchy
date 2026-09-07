import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { assertAppBase } from '../../src/services/assets/paths.ts';
import { readContent } from './read-content.ts';
import { assertCompleteContent, inspectResources } from './resources.ts';

export function contentPlugin(check: boolean): Plugin {
  let root: string;
  let building = false;
  let available: string[] = [];
  return {
    name: 'tamchy-content',
    configResolved(config) {
      assertAppBase(config.base);
      root = config.root;
      building = config.command === 'build';
      if (
        resolve(root, config.build.outDir) !==
        resolve(root, check ? '.build-check' : 'dist')
      ) {
        throw new Error(
          'Артефакты build и build:check должны оставаться в своих каталогах',
        );
      }
    },
    async transformIndexHtml(html) {
      const { strings } = await readContent(root);
      return html.replace('%APP_NAME%', strings.app.name);
    },
    async buildStart() {
      if (!building) return;
      const { catalog } = await readContent(root);
      const report = await inspectResources(resolve(root, 'public'), catalog);
      if (report.errors.length) throw new Error(report.errors.join('\n'));
      if (!check) assertCompleteContent(report);
      available = report.available;
    },
    async generateBundle(_options, bundle) {
      for (const entry of Object.values(bundle)) {
        if (
          entry.type === 'chunk' &&
          Object.keys(entry.modules).some((id) =>
            /\/(?:scripts|assets-source)\/|\/node_modules\/(?:zod|sharp)\//.test(
              id,
            ),
          )
        ) {
          throw new Error(
            'Инструменты подготовки или мастер-ресурсы попали в клиентский код',
          );
        }
      }
      // Копируется только проверенный список, включая учебные и интерактивные MP3.
      for (const path of available) {
        this.emitFile({
          type: 'asset',
          fileName: path,
          source: await readFile(resolve(root, 'public', path)),
        });
      }
    },
  };
}
