import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { snapshotFiles, verifyRelease, preserveRelease } from './release.ts';
import type { ReleaseReport } from './release.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(base: '/' | '/tamchy/' = '/tamchy/') {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-release-test-'));
  roots.push(root);
  const dist = join(root, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<html>Тамчы</html>');
  await writeFile(
    join(dist, 'offline-manifest.json'),
    JSON.stringify({ base, release: 'a'.repeat(20) }),
  );
  const report: ReleaseReport = {
    schema: 1,
    base,
    release: 'a'.repeat(20),
    version: '0.1.0',
    commit: 'b'.repeat(40),
    dirty: false,
    e2e: 'full',
    files: await snapshotFiles(dist),
    budgets: {
      js: 0,
      css: 0,
      firstScreen: 0,
      complete: 0,
      illustration: 0,
      neutralIllustration: 0,
    },
  };
  return { root, dist, report };
}
it('явно выбирает базу: корневая сборка не может стать Pages даже последней', async () => {
  const { dist, report } = await fixture('/');
  await expect(verifyRelease(dist, report, '/tamchy/')).rejects.toThrow('base');
});
it('сохраняет ровно проверенные байты независимо от следующей сборки в dist', async () => {
  const { root, dist, report } = await fixture();
  const destination = join(root, 'selected');
  await preserveRelease(dist, destination, report);
  await writeFile(join(dist, 'index.html'), 'следующая корневая сборка');
  await expect(
    verifyRelease(join(destination, 'dist'), report, '/tamchy/'),
  ).resolves.toBeUndefined();
  await expect(verifyRelease(dist, report, '/tamchy/')).rejects.toThrow(
    'файлы',
  );
});
it.each(['изменение', 'добавление', 'удаление'] as const)(
  'отклоняет %s после тестов или передачи',
  async (change) => {
    const { dist, report } = await fixture();
    if (change === 'удаление') await rm(join(dist, 'index.html'));
    else
      await writeFile(
        join(dist, change === 'добавление' ? 'screenshot.png' : 'index.html'),
        'changed',
      );
    await expect(verifyRelease(dist, report, '/tamchy/')).rejects.toThrow(
      'файлы',
    );
  },
);
it('не сохраняет изменённый во время тестов артефакт', async () => {
  const { root, dist, report } = await fixture();
  await writeFile(join(dist, 'index.html'), 'changed');
  await expect(
    preserveRelease(dist, join(root, 'selected'), report),
  ).rejects.toThrow('файлы');
});
it('не принимает фильтрованный прогон, другой коммит и грязный CI-артефакт', async () => {
  const { dist, report } = await fixture();
  await expect(
    verifyRelease(dist, { ...report, e2e: 'filtered' }, '/tamchy/'),
  ).rejects.toThrow('полный');
  await expect(
    verifyRelease(dist, report, '/tamchy/', 'c'.repeat(40)),
  ).rejects.toThrow('коммит');
  await expect(
    verifyRelease(dist, { ...report, dirty: true }, '/tamchy/', report.commit),
  ).rejects.toThrow('изменения');
});
it('не допускает символическую ссылку на файл или каталог в упаковку', async () => {
  const { root, dist } = await fixture();
  await symlink(root, join(dist, 'linked'));
  await expect(snapshotFiles(dist)).rejects.toThrow('ссылка');
});
