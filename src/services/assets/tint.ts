export type NeutralPixels = {
  width: number;
  height: number;
  // Серый тон и альфа хранятся отдельно от композиции браузера.
  data: Uint8Array;
};

export type TintedPixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
};

export function tintNeutralPixels(
  source: NeutralPixels,
  hex: string,
): TintedPixels {
  if (
    !/^#[0-9a-f]{6}$/i.test(hex) ||
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    source.data.length !== source.width * source.height * 2
  ) {
    throw new Error('Некорректные параметры перекраски');
  }
  const channels = [1, 3, 5].map((offset) =>
    parseInt(hex.slice(offset, offset + 2), 16),
  );
  const lookup = new Uint8Array(256 * 3);
  for (let tone = 0; tone < 256; tone++) {
    for (let channel = 0; channel < 3; channel++) {
      const target = channels[channel]!;
      lookup[tone * 3 + channel] = Math.round(
        tone <= 128
          ? (target * tone) / 128
          : target + ((255 - target) * (tone - 128)) / 127,
      );
    }
  }
  const data = new Uint8ClampedArray(source.width * source.height * 4);
  for (
    let input = 0, output = 0;
    input < source.data.length;
    input += 2, output += 4
  ) {
    const color = source.data[input]! * 3;
    data[output] = lookup[color]!;
    data[output + 1] = lookup[color + 1]!;
    data[output + 2] = lookup[color + 2]!;
    data[output + 3] = source.data[input + 1]!;
  }
  return { width: source.width, height: source.height, data };
}
