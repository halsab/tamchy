import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAssetCache } from './asset-cache.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-asset-cache-'));
  roots.push(root);
  const generate = vi.fn(async () => Buffer.from('valid image'));
  const validate = vi.fn(async (data: Buffer) => {
    expect(data.toString()).toBe('valid image');
  });
  return {
    root,
    generate,
    validate,
    path: 'public/icons/icon.png',
    input: Buffer.from('master'),
  };
}
it('переиспользует проверенные байты между запусками, повторяя валидацию', async () => {
  const s = await fixture();
  for (let run = 0; run < 2; run++) {
    const cache = await createAssetCache(s.root, 'tools-v1');
    await cache.prepare(s.path, s.input, s.generate, s.validate);
    await cache.save();
  }
  expect(s.generate).toHaveBeenCalledTimes(1);
  expect(s.validate).toHaveBeenCalledTimes(2);
  expect(await readFile(join(s.root, s.path), 'utf8')).toBe('valid image');
});
it.each(['source', 'tools', 'missing', 'corrupt', 'manifest'] as const)(
  'пересоздаёт производную при изменении %s',
  async (change) => {
    const s = await fixture();
    const cache = await createAssetCache(s.root, 'tools-v1');
    await cache.prepare(s.path, s.input, s.generate, s.validate);
    await cache.save();
    if (change === 'missing') await rm(join(s.root, s.path));
    if (change === 'corrupt') await writeFile(join(s.root, s.path), 'damaged');
    if (change === 'manifest')
      await writeFile(join(s.root, '.cache/assets/manifest.json'), '{');
    const next = await createAssetCache(
      s.root,
      change === 'tools' ? 'tools-v2' : 'tools-v1',
    );
    await next.prepare(
      s.path,
      change === 'source' ? Buffer.from('new master') : s.input,
      s.generate,
      s.validate,
    );
    expect(s.generate).toHaveBeenCalledTimes(2);
  },
);
it('не сохраняет не прошедшую валидацию производную', async () => {
  const s = await fixture();
  const cache = await createAssetCache(s.root, 'tools');
  await expect(
    cache.prepare(s.path, s.input, s.generate, async () => {
      throw new Error('invalid');
    }),
  ).rejects.toThrow('invalid');
  await expect(readFile(join(s.root, s.path))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
