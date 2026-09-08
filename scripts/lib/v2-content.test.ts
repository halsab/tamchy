import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  readV2Content,
  parseV2Content,
  v2ResourcePaths,
} from './v2-content.ts';

const root = resolve(import.meta.dirname, '../..');

describe('полный каталог младшего v2', () => {
  it('связывает 13 цветов, 39 животных, 20 чисел и 13 типов счёта с настоящими реестрами', async () => {
    const content = await readV2Content(root);
    expect(content.categories.map((x) => x.id)).toEqual([
      'colors',
      'animals',
      'numbers',
    ]);
    expect(content.colors).toHaveLength(13);
    expect(content.animals).toHaveLength(39);
    expect(content.numbers.map((x) => x.value)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(content.countObjects).toHaveLength(13);
    expect(
      content.countObjects.filter((x) => x.kind === 'tinted'),
    ).toHaveLength(12);
    const cube = content.countObjects.find(
      (x) => x.id === 'color-object-cube',
    )!;
    const square = content.countObjects.find((x) => x.id === 'shape-square')!;
    expect(cube.labelClipId).toBe(square.labelClipId);
    expect(cube.image).not.toBe(square.image);
    expect(content.audio).toHaveLength(189);
  });

  it('требует ровно 43 WebP, 12 нейтральных PNG, 4 иконки и 189 MP3', async () => {
    const paths = v2ResourcePaths(await readV2Content(root));
    expect(paths.images.filter((x) => x.endsWith('.webp'))).toHaveLength(43);
    expect(paths.images.filter((x) => x.endsWith('.png'))).toHaveLength(12);
    expect(paths.icons).toHaveLength(4);
    expect(paths.audio).toHaveLength(189);
    expect(paths.audio.filter((x) => x.includes('/interaction/'))).toHaveLength(
      12,
    );
    expect(
      paths.audio.every(
        (x) =>
          x.startsWith('assets/audio/tt/clips/') ||
          x.startsWith('assets/audio/tt/interaction/'),
      ),
    ).toBe(true);
    expect(
      new Set([...paths.images, ...paths.icons, ...paths.audio]).size,
    ).toBe(248);
  });

  it.each([
    [
      'пропуск цвета',
      (x) => {
        x.colors.pop();
      },
    ],
    [
      'чужой HEX',
      (x) => {
        x.colors[0]!.hex = '#123456';
      },
    ],
    [
      'дубликат животного',
      (x) => {
        x.animals[1] = x.animals[0]!;
      },
    ],
    [
      'неверное название',
      (x) => {
        x.animals[0]!.labelTt = 'Аю';
      },
    ],
    [
      'чужая картинка',
      (x) => {
        x.animals[0]!.image = x.animals[1]!.image;
      },
    ],
    [
      'неизвестная словоформа',
      (x) => {
        x.animals[0]!.targetClipId = 'animal.unknown.target';
      },
    ],
    [
      'чужая словоформа',
      (x) => {
        x.animals[0]!.targetClipId = x.animals[1]!.targetClipId;
      },
    ],
    [
      'число вне каталога',
      (x) => {
        x.numbers[0]!.value = 21;
      },
    ],
    [
      'повтор числа',
      (x) => {
        x.numbers[1] = x.numbers[0]!;
      },
    ],
    [
      'неполный счётный пул',
      (x) => {
        x.countObjects.pop();
      },
    ],
    [
      'SVG вместо PNG',
      (x) => {
        x.countObjects[1]!.image = 'assets/images/shapes/shape-circle.svg';
      },
    ],
    [
      'неизвестный клип рецепта',
      (x) => {
        x.recipes.C1[0]!.parts[1] = 'common.unknown';
      },
    ],
    [
      'неправильная формула',
      (x) => {
        x.recipes.A1[1]!.parts[0] = '$label';
      },
    ],
    [
      'пропущенная формулировка',
      (x) => {
        x.recipes.A1.pop();
      },
    ],
    [
      'пропущенная запись',
      (x) => {
        x.audio.pop();
      },
    ],
    [
      'путь вне public',
      (x) => {
        x.audio[0]!.path = '../audio.mp3';
      },
    ],
    [
      'неверный порядок разделов',
      (x) => {
        x.categories.reverse();
      },
    ],
  ] satisfies [string, (value: MutableContent) => void][])(
    'отклоняет: %s',
    async (_name, mutate) => {
      const content = structuredClone(
        await readV2Content(root),
      ) as unknown as MutableContent;
      mutate(content);
      expect(() => parseV2Content(content)).toThrow();
    },
  );
});

type MutableContent = {
  categories: { id: string }[];
  colors: { hex: string }[];
  animals: { labelTt: string; image: string; targetClipId: string }[];
  numbers: { value: number }[];
  countObjects: { image: string }[];
  recipes: Record<'C1' | 'A1' | 'N1-A', { parts: string[] }[]>;
  audio: { path: string }[];
};
