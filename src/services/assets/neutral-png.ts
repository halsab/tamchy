import { decode, hasPngSignature } from 'fast-png';
import type { NeutralPixels } from './tint.ts';

export function decodeNeutralPng(png: Uint8Array): NeutralPixels {
  // Ограничение IHDR проверяется до декодера, чтобы повреждённый ресурс не выделил произвольный объём памяти.
  if (
    png.length < 33 ||
    png.length > 2 * 1024 * 1024 ||
    !hasPngSignature(png)
  ) {
    throw new Error('Некорректный нейтральный PNG');
  }
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== 1024 ||
    header.getUint32(20) !== 1024 ||
    png[24] !== 8 ||
    (png[25] !== 4 && png[25] !== 6)
  ) {
    throw new Error('Ожидается нейтральный PNG 1024×1024 с альфой');
  }
  const image = decode(png, { checkCrc: true });
  const data = new Uint8Array(image.width * image.height * 2);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const offset = pixel * image.channels;
    const tone = image.data[offset]!;
    const alpha = image.data[offset + image.channels - 1]!;
    if (
      image.channels === 4 &&
      alpha &&
      (tone !== image.data[offset + 1] || tone !== image.data[offset + 2])
    ) {
      throw new Error('PNG содержит цветные пиксели');
    }
    data[pixel * 2] = tone;
    data[pixel * 2 + 1] = alpha;
  }
  return { width: image.width, height: image.height, data };
}
