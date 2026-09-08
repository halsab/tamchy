import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readV2Content, parseV2Content } from './v2-content.ts';

const root = resolve(import.meta.dirname, '../..');
describe('каталог старшего режима', () => {
  it('подключает формы, размеры, все рецепты и проверенные животные без новых ресурсов', async () => {
    const content = await readV2Content(root);
    expect(content.shapes).toHaveLength(6);
    expect(content.sizes.map((x) => x.id)).toEqual(['big', 'small']);
    expect(Object.keys(content.recipes)).toHaveLength(14);
    expect(content.animalTraits.animals).toHaveLength(39);
    expect(content.silhouetteConflicts.pairs).toHaveLength(50);
    expect(
      content.animalTraits.traits.filter((x) => x.generation === 'enabled'),
    ).toHaveLength(4);
    expect(content.audio).toHaveLength(189);
  });
  it.each([
    [
      'неизвестная форма',
      (x) => {
        x.shapes[0]!.countObjectId = 'count-apple';
      },
    ],
    [
      'неверный размер',
      (x) => {
        x.sizes[0]!.labelClipId = 'size.small';
      },
    ],
    [
      'неверная словоформа C3',
      (x) => {
        x.recipes['C3-A']![0]!.parts[1]! = '$shape';
      },
    ],
    [
      'неизвестный клип',
      (x) => {
        x.recipes.C2![0]!.parts[0]! = 'unknown';
      },
    ],
    [
      'пустая матрица',
      (x) => {
        x.animalTraits.animals = [];
      },
    ],
    [
      'ложное значение вместо исключения',
      (x) => {
        x.animalTraits.animals[0]!.values.canSwim = false;
      },
    ],
    [
      'включённое плавание',
      (x) => {
        x.animalTraits.traits[4]!.generation = 'enabled';
      },
    ],
    [
      'нет помех',
      (x) => {
        x.animalTraits.animals.forEach((a) => {
          a.values.bird = 'yes';
        });
      },
    ],
    [
      'повтор пары наоборот',
      (x) => {
        x.silhouetteConflicts.pairs.push({
          ...x.silhouetteConflicts.pairs[0]!,
          animalIds: [...x.silhouetteConflicts.pairs[0]!.animalIds].reverse(),
        });
      },
    ],
    [
      'неизвестное животное',
      (x) => {
        x.silhouetteConflicts.pairs[0]!.animalIds[0]! = 'unknown';
      },
    ],
    [
      'изменённый мастер',
      (x) => {
        x.silhouetteConflicts.animals[0]!.masterSha256 = '0'.repeat(64);
      },
    ],
    [
      'невозможная цель',
      (x) => {
        const target = x.animals[0]!.id;
        x.silhouetteConflicts.pairs = x.animals.slice(1).map((a) => ({
          animalIds: [target, a.id],
          reasonRu: 'Проверка невозможного набора',
        }));
      },
    ],
  ] satisfies [string, (x: MutableContent) => void][])(
    'отклоняет: %s',
    async (_, change) => {
      const content = JSON.parse(
        JSON.stringify(await readV2Content(root)),
      ) as MutableContent;
      change(content);
      expect(() => parseV2Content(content)).toThrow();
    },
  );
});
type MutableContent = {
  shapes: { countObjectId: string }[];
  sizes: { labelClipId: string }[];
  recipes: Record<string, { parts: string[] }[]>;
  animals: { id: string }[];
  animalTraits: {
    animals: { values: Record<string, string | boolean> }[];
    traits: { generation: string }[];
  };
  silhouetteConflicts: {
    animals: { masterSha256: string }[];
    pairs: { animalIds: string[]; reasonRu: string }[];
  };
};

it('проверка сборки отклоняет производную, чей хеш отличается от просмотренного силуэта', async () => {
  const { validateReviewedGraphics } = await import('./senior-content.ts');
  const content = await readV2Content(root);
  await expect(
    validateReviewedGraphics(root, content),
  ).resolves.toBeUndefined();
  const changed = {
    ...content,
    silhouetteConflicts: {
      ...content.silhouetteConflicts,
      animals: content.silhouetteConflicts.animals.map((x, i) =>
        i === 0 ? { ...x, webpSha256: '0'.repeat(64) } : x,
      ),
    },
  };
  await expect(validateReviewedGraphics(root, changed)).rejects.toThrow(
    'силуэта',
  );
});
