import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  rename,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import data from '../../src/content/catalog.json' with { type: 'json' };
import { parseCatalog } from './catalog.ts';
import {
  assertCompleteContent,
  formatResourceReport,
  inspectResources,
  resourcePaths,
} from './resources.ts';

const catalog = parseCatalog(data);
const directories: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-resources-'));
  directories.push(root);
  const paths = resourcePaths(catalog);
  for (const path of [...paths.images, ...paths.icons, ...paths.audio]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    // Содержимое проверяется отдельно; здесь проверяется только файловый контракт.
    await writeFile(join(root, path), 'file-presence-fixture');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('полнота обязательных ресурсов', () => {
  it('требует 10 иллюстраций, 4 иконки, 30 учебных записей без interaction', async () => {
    const paths = resourcePaths(catalog);
    expect(paths.images).toHaveLength(10);
    expect(paths.icons).toHaveLength(4);
    expect(paths.audio).toHaveLength(30);
    expect(paths.audio.every((path) => !path.includes('interaction/'))).toBe(
      true,
    );
    const report = await inspectResources(await fixture(), catalog);
    expect(report.resourcesComplete).toBe(true);
    expect(() => assertCompleteContent(report)).not.toThrow();
  });

  it('каталог честно сообщает о неполном аудио; строгая проверка отклоняет его', async () => {
    const root = await fixture();
    const missing = resourcePaths(catalog).audio[0]!;
    await rm(join(root, missing));
    const report = await inspectResources(root, catalog);
    expect(report.errors).toEqual([]);
    expect(report.missingAudio).toEqual([missing]);
    expect(report.resourcesComplete).toBe(false);
    expect(formatResourceReport(report)).toContain(missing);
    expect(formatResourceReport(report)).toContain('не готов');
    expect(() => assertCompleteContent(report)).toThrow(missing);
  });

  it('отсутствующая картинка блокирует также проверку каталога', async () => {
    const root = await fixture();
    const missing = resourcePaths(catalog).images[0]!;
    await rm(join(root, missing));
    const report = await inspectResources(root, catalog);
    expect(report.errors.join('\n')).toContain(missing);
    expect(report.resourcesComplete).toBe(false);
    expect(() => assertCompleteContent(report)).toThrow(missing);
  });

  it('проверяет точный регистр даже на macOS', async () => {
    const root = await fixture();
    const path = resourcePaths(catalog).audio[0]!;
    await rename(
      join(root, path),
      join(root, path.replace('color-red', 'Color-red')),
    );
    const report = await inspectResources(root, catalog);
    expect(report.errors.join('\n')).toContain('Регистр');
    expect(() => assertCompleteContent(report)).toThrow(path);
  });

  it('не считает пустой файл, каталог и симлинк готовым ресурсом', async () => {
    const root = await fixture();
    const [empty, directory, link] = resourcePaths(catalog).audio as [
      string,
      string,
      string,
    ];
    await writeFile(join(root, empty), '');
    await rm(join(root, directory));
    await mkdir(join(root, directory));
    await rm(join(root, link));
    await symlink(join(root, empty), join(root, link));
    const report = await inspectResources(root, catalog);
    expect(report.errors).toHaveLength(3);
    expect(() => assertCompleteContent(report)).toThrow();
  });
});
