import { resourcePaths } from './resources.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { readV2Content } from './v2-content.ts';
import { assertCompleteContent, inspectResourcePaths } from './resources.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('строгий перечень v2 отклоняет новые MP3, нейтральные PNG и животных при отсутствии', async () => {
  const content = await readV2Content(resolve(import.meta.dirname, '../..'));
  const paths = resourcePaths(content);
  const directory = await mkdtemp(join(tmpdir(), 'tamchy-v2-resources-'));
  directories.push(directory);
  for (const path of [...paths.images, ...paths.audio, ...paths.icons]) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    // Проверяется файловый контракт; декодирование настоящих ресурсов проверяется отдельно.
    await writeFile(join(directory, path), 'file-presence-fixture');
  }
  expect((await inspectResourcePaths(directory, paths)).resourcesComplete).toBe(
    true,
  );
  for (const missing of [
    'assets/audio/tt/clips/number-20-target.mp3',
    'assets/audio/tt/interaction/goodbye.mp3',
    'assets/images/animals/animal-goat.webp',
    'assets/images/shapes/shape-circle.png',
    'icons/apple-touch-icon.png',
  ]) {
    await rm(join(directory, missing));
    const report = await inspectResourcePaths(directory, paths);
    expect(report.resourcesComplete).toBe(false);
    expect(() => assertCompleteContent(report)).toThrow(missing);
    await writeFile(join(directory, missing), 'file-presence-fixture');
  }
});
