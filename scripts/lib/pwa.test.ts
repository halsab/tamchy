import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPwaOptions } from './pwa.ts';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it('база изолирует scope/cache, MP3 и WebP явные; аудио меняет release без смены версии пакета', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-pwa-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'public'), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'const version = "a";');
  await writeFile(join(root, 'public/audio.mp3'), 'audio-a');
  const a = await createPwaOptions(root, '/', '0.1.0', ['audio.mp3']);
  const sub = await createPwaOptions(root, '/tamchy/', '0.1.0', ['audio.mp3']);
  expect(
    a.options.workbox?.dontCacheBustURLsMatching?.test(
      'assets/audio/tt/colors/color-red-label.mp3',
    ),
  ).toBe(false);
  expect(a.options.registerType).toBe('prompt');
  expect(a.options.workbox?.skipWaiting).toBe(false);
  expect(a.options.workbox?.clientsClaim).toBe(false);
  expect(a.options.workbox?.globPatterns?.join()).toContain('mp3');
  expect(a.options.workbox?.globPatterns?.join()).toContain('webp');
  expect(sub.options.manifest).toMatchObject({
    id: '/tamchy/',
    scope: '/tamchy/',
    start_url: '/tamchy/#/',
    name: 'Тамчы',
    lang: 'tt',
  });
  expect(a.options.workbox?.cacheId).not.toBe(sub.options.workbox?.cacheId);
  await writeFile(join(root, 'public/audio.mp3'), 'audio-b');
  const b = await createPwaOptions(root, '/', '0.1.0', ['audio.mp3']);
  expect(b.release).not.toBe(a.release);
  expect(await readFile(join(root, 'src/app.ts'), 'utf8')).toContain('"a"');
});
