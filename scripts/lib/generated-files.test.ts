import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { writeGenerated } from './generated-files.ts';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-generated-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it('повторно записывает только указанный файл и сохраняет соседние материалы', async () => {
  const root = await fixture();
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'public/owner.txt'), 'owner material');
  await writeGenerated(root, 'public/icons/icon.png', Buffer.from('first'));
  await writeGenerated(root, 'public/icons/icon.png', Buffer.from('second'));
  expect(await readFile(join(root, 'public/icons/icon.png'), 'utf8')).toBe(
    'second',
  );
  expect(await readFile(join(root, 'public/owner.txt'), 'utf8')).toBe(
    'owner material',
  );
});

it('не пишет через симлинк каталога или выходного файла', async () => {
  const root = await fixture();
  await mkdir(join(root, 'owner'));
  await writeFile(join(root, 'owner/original.png'), 'original');
  await symlink(join(root, 'owner'), join(root, 'public'));
  await expect(
    writeGenerated(root, 'public/icon.png', Buffer.from('new')),
  ).rejects.toThrow('Небезопасный каталог');
  await rm(join(root, 'public'));
  await mkdir(join(root, 'public'));
  await symlink(
    join(root, 'owner/original.png'),
    join(root, 'public/icon.png'),
  );
  await expect(
    writeGenerated(root, 'public/icon.png', Buffer.from('new')),
  ).rejects.toThrow('Нельзя перезаписать');
  expect(await readFile(join(root, 'owner/original.png'), 'utf8')).toBe(
    'original',
  );
});
