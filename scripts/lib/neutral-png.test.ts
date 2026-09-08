import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import graphics from '../../src/content/v2/graphics.json' with { type: 'json' };
import colors from '../../src/content/v2/colors.json' with { type: 'json' };
import { decodeNeutralPng } from '../../src/services/assets/neutral-png.ts';
import { tintNeutralPixels } from '../../src/services/assets/tint.ts';
import { optimizeNeutralPng } from './neutral-png.ts';

const root = resolve(import.meta.dirname, '../..');
const neutral = graphics.filter(
  ({ id }) => id.startsWith('shape-') || id.startsWith('color-object-'),
);

describe('реальные нейтральные PNG', () => {
  it.each(neutral)(
    '$id: производная без потерь и 13 цветов',
    async ({ source, sha256 }) => {
      const input = await readFile(resolve(root, source));
      const derivative = await optimizeNeutralPng(input, sha256);
      const original = await sharp(input).ensureAlpha().raw().toBuffer();
      const restored = await sharp(derivative)
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(restored.equals(original)).toBe(true);
      expect(derivative.length).toBeLessThan(input.length);
      expect(derivative.length).toBeLessThanOrEqual(300 * 1024);
      const decoded = decodeNeutralPng(new Uint8Array(derivative));
      expect([decoded.width, decoded.height]).toEqual([1024, 1024]);
      let sourceErrors = 0;
      for (let i = 0; i < original.length / 4; i++) {
        if (
          decoded.data[i * 2] !== original[i * 4] ||
          decoded.data[i * 2 + 1] !== original[i * 4 + 3]
        )
          sourceErrors++;
      }
      expect(sourceErrors).toBe(0);
      for (const { hex } of colors) {
        const tinted = tintNeutralPixels(decoded, hex);
        const rgb = [1, 3, 5].map((start) =>
          parseInt(hex.slice(start, start + 2), 16),
        );
        let errors = 0;
        for (let i = 0; i < decoded.data.length / 2; i++) {
          if (tinted.data[i * 4 + 3] !== decoded.data[i * 2 + 1]) errors++;
          if (decoded.data[i * 2] === 128) {
            for (let channel = 0; channel < 3; channel++)
              if (tinted.data[i * 4 + channel] !== rgb[channel]) errors++;
          }
        }
        expect(errors, hex).toBe(0);
      }
    },
    15000,
  );

  it('отклоняет изменённый мастер, повреждённый PNG и неверные размеры', async () => {
    const entry = neutral[0]!;
    const input = await readFile(resolve(root, entry.source));
    await expect(optimizeNeutralPng(input, '0'.repeat(64))).rejects.toThrow(
      'SHA-256',
    );
    expect(() => decodeNeutralPng(new Uint8Array([1, 2, 3]))).toThrow();
    const wrongSize = await sharp(input).resize(32, 32).png().toBuffer();
    expect(() => decodeNeutralPng(new Uint8Array(wrongSize))).toThrow();
    const corrupted = new Uint8Array(input);
    corrupted[50] = corrupted[50]! ^ 255;
    expect(() => decodeNeutralPng(corrupted)).toThrow();
  });
});
