import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import graphics from '../../src/content/v2/graphics.json' with { type: 'json' };
import { decodeNeutralPng } from '../../src/services/assets/neutral-png.ts';
import { writeGenerated } from './generated-files.ts';
import type { AssetCache } from './asset-cache.ts';

export const neutralPngBudget = 300 * 1024;
export const neutralImages = graphics.filter(
  ({ id }) => id.startsWith('shape-') || id.startsWith('color-object-'),
);

export async function optimizeNeutralPng(input: Buffer, expectedHash: string) {
  if (createHash('sha256').update(input).digest('hex') !== expectedHash)
    throw new Error('SHA-256 нейтрального мастера не совпадает с реестром');
  decodeNeutralPng(input);
  const output = await sharp(input)
    .toColourspace('b-w')
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false,
    })
    .toBuffer();
  await validateNeutralPng(input, output);
  return output;
}

async function validateNeutralPng(input: Buffer, output: Buffer) {
  decodeNeutralPng(input);
  decodeNeutralPng(output);
  const original = await sharp(input).ensureAlpha().raw().toBuffer();
  const restored = await sharp(output)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
  if (!original.equals(restored))
    throw new Error('Производная изменила RGBA мастера');
  if (output.length > neutralPngBudget)
    throw new Error('Нейтральный PNG превышает 300 КиБ');
}

export async function prepareNeutralAssets(root: string, cache?: AssetCache) {
  const results: { path: string; bytes: number }[] = [];
  for (const { source, outputs, sha256 } of neutralImages) {
    const input = await readFile(resolve(root, source));
    const path = outputs[0]!;
    if (createHash('sha256').update(input).digest('hex') !== sha256)
      throw new Error('SHA-256 нейтрального мастера не совпадает с реестром');
    const output = cache
      ? await cache.prepare(
          `public/${path}`,
          input,
          () => optimizeNeutralPng(input, sha256),
          (data) => validateNeutralPng(input, data),
        )
      : await optimizeNeutralPng(input, sha256);
    if (!cache) await writeGenerated(root, `public/${path}`, output);
    results.push({ path, bytes: output.length });
  }
  return results;
}
