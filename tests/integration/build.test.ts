import {
  cp,
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
import { contentV2 } from '../../src/content/v2/catalog.ts';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentPlugin } from '../../scripts/lib/content-plugin.ts';
import { resourcePaths } from '../../scripts/lib/resources.ts';

const roots: string[] = [];
const paths = resourcePaths(contentV2);
const graphics = [...paths.images, ...paths.icons];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-build-'));
  roots.push(root);
  await cp('src/content/v2', join(root, 'src/content/v2'), { recursive: true });
  const files: Record<string, string> = {
    'src/content/tt.json': JSON.stringify(strings),
    'src/styles/fonts/OFL.txt': await readFile(
      'src/styles/fonts/OFL.txt',
      'utf8',
    ),
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
  // Сборочная проверка теперь сверяет просмотренные силуэты, поэтому здесь нужны исходные производные.
  await cp(
    'public/assets/images/animals',
    join(root, 'public/assets/images/animals'),
    { recursive: true },
  );
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
  base = '/tamchy/',
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
  it('техническая сборка с base /tamchy/ содержит только разрешённые ресурсы', async () => {
    const base = '/tamchy/';
    const root = await fixture();
    await compile(root, true, base);
    const files = await filesAt(join(root, '.build-check'));
    const staticFiles = files.filter(
      (path) => path !== 'index.html' && !path.endsWith('.js'),
    );
    expect(staticFiles.sort()).toEqual(
      [...graphics, 'assets/nunito-OFL.txt'].sort(),
    );
    const html = await readFile(join(root, '.build-check/index.html'), 'utf8');
    expect(html).toContain('<title>Тамчы</title>');
    expect(html).toContain(`${base}icons/pwa-192x192.png`);
    expect(html).toContain(`src="${base}assets/`);
    expect(await readFile(join(root, 'public/owner.txt'), 'utf8')).toBe(
      'owner material',
    );
    await expect(readdir(join(root, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('отклоняет изменённое изображение просмотренного силуэта', async () => {
    const root = await fixture();
    await writeFile(
      join(root, 'public/assets/images/animals/animal-cat.webp'),
      'changed',
    );
    await expect(compile(root, true)).rejects.toThrow('силуэта');
  });

  it.each(['recipe', 'trait', 'silhouette'] as const)(
    'релизная сборка отклоняет недопустимый старший каталог: %s',
    async (failure) => {
      const root = await fixture();
      const source = contentV2;
      const variants = {
        recipe: {
          ...source.recipes,
          'C3-A': source.recipes['C3-A'].map((recipe, index) =>
            index
              ? recipe
              : {
                  ...recipe,
                  parts: ['unknown.clip', ...recipe.parts.slice(1)],
                },
          ),
        },
        trait: {
          ...source.animalTraits,
          animals: source.animalTraits.animals.map((animal) => ({
            ...animal,
            values: { ...animal.values, bird: 'yes' },
          })),
        },
        silhouette: {
          ...source.silhouetteConflicts,
          pairs: source.animals.slice(1).map((animal) => ({
            animalIds: [source.animals[0]!.id, animal.id],
            reasonRu: 'Проверка невозможного набора.',
          })),
        },
      };
      const filename =
        failure === 'recipe'
          ? 'recipes.json'
          : failure === 'trait'
            ? 'animal-traits.json'
            : 'silhouette-conflicts.json';
      const value = variants[failure];
      await writeFile(
        join(root, 'src/content/v2', filename),
        JSON.stringify(value),
      );
      await expect(compile(root, false)).rejects.toThrow(
        failure === 'recipe'
          ? /Рецепт|клип/
          : failure === 'trait'
            ? /A2/
            : /A3/,
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
    await mkdir(dirname(join(root, 'public', path)), { recursive: true });
    await writeFile(join(root, 'public', path), 'file-presence-fixture');
    await compile(root, true);
    expect(await readFile(join(root, '.build-check', path), 'utf8')).toBe(
      'file-presence-fixture',
    );
  });

  it('запрещает подмену каталога технической сборки на dist', async () => {
    await expect(
      compile(await fixture(), true, '/tamchy/', 'dist'),
    ).rejects.toThrow('в своих каталогах');
  });

  it('отклоняет внешний base вместо создания внешних URL ресурсов', async () => {
    await expect(
      compile(await fixture(), true, 'https://example.test/'),
    ).rejects.toThrow('base');
  });
});
