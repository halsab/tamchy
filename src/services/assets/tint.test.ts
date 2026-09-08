import { describe, expect, it } from 'vitest';
import colors from '../../content/v2/colors.json';
import { tintNeutralPixels } from './tint.ts';

describe('перекраска нейтральных пикселей', () => {
  it.each(colors)(
    'точный $hex при тоне 128, включая прозрачные края',
    ({ hex }) => {
      const source = new Uint8Array([128, 0, 128, 1, 128, 127, 128, 255]);
      const result = tintNeutralPixels(
        { width: 4, height: 1, data: source },
        hex,
      );
      const rgb = [1, 3, 5].map((start) =>
        parseInt(hex.slice(start, start + 2), 16),
      );
      expect([...result.data]).toEqual(
        [0, 1, 127, 255].flatMap((alpha) => [...rgb, alpha]),
      );
      expect([...source]).toEqual([128, 0, 128, 1, 128, 127, 128, 255]);
    },
  );

  it('сохраняет тени, блики и альфу с округлением до ближайшего целого', () => {
    const result = tintNeutralPixels(
      {
        width: 5,
        height: 1,
        data: new Uint8Array([0, 255, 64, 90, 128, 255, 192, 200, 255, 255]),
      },
      '#D94343',
    );
    expect([...result.data]).toEqual([
      0, 0, 0, 255, 109, 34, 34, 90, 217, 67, 67, 255, 236, 162, 162, 200, 255,
      255, 255, 255,
    ]);
  });

  it.each(colors)('все 256 тонов монотонны для $hex', ({ hex }) => {
    const source = Uint8Array.from(
      Array.from({ length: 256 }, (_, tone) => [tone, tone]).flat(),
    );
    const result = tintNeutralPixels(
      { width: 256, height: 1, data: source },
      hex,
    );
    for (let tone = 0; tone < 256; tone++) {
      expect(result.data[tone * 4 + 3]).toBe(tone);
      for (let channel = 0; channel < 3; channel++) {
        const value = result.data[tone * 4 + channel]!;
        if (tone)
          expect(value).toBeGreaterThanOrEqual(
            result.data[(tone - 1) * 4 + channel]!,
          );
      }
    }
  });

  it('отклоняет неверный HEX и несогласованные размеры', () => {
    const source = { width: 1, height: 1, data: new Uint8Array([128, 255]) };
    expect(() => tintNeutralPixels(source, 'red')).toThrow();
    expect(() =>
      tintNeutralPixels({ ...source, width: 2 }, '#FFFFFF'),
    ).toThrow();
  });
});
