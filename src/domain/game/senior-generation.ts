import type { ContentV2, ExerciseKind } from '../../content/types.ts';
import type {
  AnimalOption,
  ColorOption,
  CountIllustration,
  NumberOption,
} from './exercise.ts';
import { resolveRecipe } from './audio-recipes.ts';
import { randomIndex, shuffle } from './random.ts';

export function byId<T extends { id: string }>(
  pool: readonly T[],
  id: string,
): T {
  const item = pool.find((x) => x.id === id);
  if (!item) throw new Error(`Неизвестный элемент ${id}.`);
  return item;
}
export function pick<T>(pool: readonly T[], random: () => number): T {
  return pool[randomIndex(pool.length, random)]!;
}
export function withDistractors<T extends { id: string }>(
  target: T,
  pool: readonly T[],
  count: number,
  random: () => number,
): T[] {
  const others = shuffle(
    pool.filter((x) => x.id !== target.id),
    random,
  );
  if (others.length < count - 1)
    throw new Error('Недостаточно уникальных помех.');
  return shuffle([target, ...others.slice(0, count - 1)], random);
}
export function speech(
  content: ContentV2,
  kind: ExerciseKind,
  recipeId: string,
  bindings: Readonly<Record<string, string>> = {},
) {
  return resolveRecipe(
    content,
    byId(content.recipes[kind], recipeId),
    bindings,
  );
}
export function colorOption(color: ContentV2['colors'][number]): ColorOption {
  return {
    kind: 'color',
    id: `color-${color.id}`,
    labelTt: color.labelTt,
    hex: color.hex,
  };
}
export function animalOption(
  animal: ContentV2['animals'][number],
): AnimalOption {
  return {
    kind: 'animal',
    id: animal.id,
    labelTt: animal.labelTt,
    image: animal.image,
  };
}
export function numberOption(
  number: ContentV2['numbers'][number],
): NumberOption {
  return {
    kind: 'number',
    id: number.id,
    labelTt: number.labelTt,
    value: number.value,
  };
}
export function countIllustration(
  content: ContentV2,
  id: string,
  random: () => number,
): CountIllustration {
  const object = byId(content.countObjects, id);
  const base = { id: object.id, image: object.image };
  return object.kind === 'raster'
    ? { ...base, kind: 'raster' }
    : { ...base, kind: 'tinted', hex: pick(content.colors, random).hex };
}
export const confirmation = (clipId: string) => ({
  type: 'clip' as const,
  clipId,
});
