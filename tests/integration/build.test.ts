import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import data from '../../src/content/catalog.json' with { type: 'json' };
import strings from '../../src/content/tt.json' with { type: 'json' };
import { parseCatalog } from '../../scripts/lib/catalog.ts';
import { contentPlugin } from '../../scripts/lib/content-plugin.ts';
import { resourcePaths } from '../../scripts/lib/resources.ts';

const roots: string[] = [];
const paths = resourcePaths(parseCatalog(data));
const graphics = [...paths.images, ...paths.icons];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-build-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/content/catalog.json': JSON.stringify(data),
    'src/content/tt.json': JSON.stringify(strings),
    'index.html':
      '<html lang="tt"><head><title>%APP_NAME%</title><link rel="icon" href="%BASE_URL%icons/pwa-192x192.png"></head><body><script type="module" src="/main.ts"></script></body></html>',
    'main.ts': 'document.body.textContent = "Тамчы";',
    'public/assets/audio/tt/colors/.gitkeep': '',
    'public/.DS_Store': 'metadata',
    'public/owner.txt': 'owner material',
    'public/assets-source/original.png': 'master fixture',
  };
  for (const path of graphics)
    files[`public/${path}`] = 'file-presence-fixture';
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function compile(
  root: string,
  check: boolean,
  base = '/',
  outDir = check ? '.build-check' : 'dist',
) {
  return build({
    configFile: false,
    root,
    base,
    plugins: [contentPlugin(check)],
    logLevel: 'silent',
    build: { outDir, copyPublicDir: false },
  });
}

async function filesAt(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
}

describe('границы сборочных артефактов', () => {
  it.each(['/', '/tamchy/'])(
    'техническая сборка с base %s содержит только разрешённые ресурсы',
    async (base) => {
      const root = await fixture();
      await compile(root, true, base);
      const files = await filesAt(join(root, '.build-check'));
      const staticFiles = files.filter(
        (path) => path !== 'index.html' && !path.endsWith('.js'),
      );
      expect(staticFiles.sort()).toEqual([...graphics].sort());
      const html = await readFile(
        join(root, '.build-check/index.html'),
        'utf8',
      );
      expect(html).toContain('<title>Тамчы</title>');
      expect(html).toContain(`${base}icons/pwa-192x192.png`);
      expect(html).toContain(`src="${base}assets/`);
      expect(await readFile(join(root, 'public/owner.txt'), 'utf8')).toBe(
        'owner material',
      );
      await expect(readdir(join(root, 'dist'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('релизная сборка останавливается до создания dist при отсутствии записи', async () => {
    const root = await fixture();
    await expect(compile(root, false)).rejects.toThrow(paths.audio[0]);
    await expect(readdir(join(root, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('включает доступную учебную запись в технический артефакт', async () => {
    const root = await fixture();
    const path = paths.audio[0]!;
    await writeFile(join(root, 'public', path), 'file-presence-fixture');
    await compile(root, true);
    expect(await readFile(join(root, '.build-check', path), 'utf8')).toBe(
      'file-presence-fixture',
    );
  });

  it('запрещает подмену каталога технической сборки на dist', async () => {
    await expect(compile(await fixture(), true, '/', 'dist')).rejects.toThrow(
      'в своих каталогах',
    );
  });

  it('отклоняет внешний base вместо создания внешних URL ресурсов', async () => {
    await expect(
      compile(await fixture(), true, 'https://example.test/'),
    ).rejects.toThrow('base');
  });
});
