import { resolveRecipe } from './audio-recipes.ts';
import { shuffle as shuffled } from './random.ts';
import type {
  AudioRecipe,
  CategoryId,
  ContentV2,
} from '../../content/types.ts';
import type { AnswerCount, JuniorExercise, SpokenPrompt } from './exercise.ts';

export function createExerciseGenerator(
  content: ContentV2,
  categoryId: CategoryId,
  random: () => number,
): (count: AnswerCount) => JuniorExercise {
  const pool =
    categoryId === 'colors'
      ? content.colors
      : categoryId === 'animals'
        ? content.animals
        : categoryId === 'numbers'
          ? content.numbers.filter((x) => x.value <= 10)
          : [];
  if (pool.length < 4)
    throw new Error('Недостаточно элементов раздела младшего режима.');
  const kind =
    categoryId === 'colors' ? 'C1' : categoryId === 'animals' ? 'A1' : 'N1-A';
  let remaining: number[] = [];
  let previous: number | undefined;
  let nextId = 1;
  let objects: number[] = [];
  const formulations = new Map<string, AudioRecipe[]>();
  const shuffle = <T>(input: readonly T[]) => shuffled(input, random);
  function promptFor(target: (typeof pool)[number]): SpokenPrompt {
    let recipes = formulations.get(target.id);
    if (!recipes?.length) {
      recipes = shuffle(content.recipes[kind]);
      formulations.set(target.id, recipes);
    }
    // Отдельный цикл формулировок гарантирует все варианты для каждой учебной цели.
    const recipe = recipes.shift()!;
    return resolveRecipe(content, recipe, {
      $label: target.labelClipId,
      ...('targetClipId' in target ? { $target: target.targetClipId } : {}),
    });
  }
  return (count) => {
    if (count !== 2 && count !== 3 && count !== 4)
      throw new RangeError('Младший режим содержит 2–4 ответа.');
    if (!remaining.length) {
      remaining = shuffle(pool.map((_, i) => i));
      // Один обмен сохраняет границу цикла даже при постоянном источнике случайности.
      if (remaining[0] === previous)
        [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
    }
    const targetIndex = remaining.shift()!;
    const target = pool[targetIndex]!;
    let distractors = shuffle(
      pool.map((_, i) => i).filter((i) => i !== targetIndex),
    );
    if ('value' in target) {
      const distance = (i: number) =>
        Math.abs((pool[i] as { value: number }).value - target.value);
      distractors = distractors.sort((a, b) => distance(a) - distance(b));
    }
    const indices = shuffle([targetIndex, ...distractors.slice(0, count - 1)]);
    previous = targetIndex;
    const base = {
      mode: 'junior' as const,
      id: nextId++,
      difficulty: 1 as const,
      prompt: promptFor(target),
      correctOptionId:
        categoryId === 'colors' ? `color-${target.id}` : target.id,
      confirmation: { type: 'clip' as const, clipId: target.labelClipId },
    };
    if (kind === 'C1')
      return {
        ...base,
        kind,
        categoryId: 'colors',
        options: indices.map((i) => {
          const color = content.colors[i]!;
          return {
            kind: 'color',
            id: `color-${color.id}`,
            labelTt: color.labelTt,
            hex: color.hex,
          };
        }),
      };
    if (kind === 'A1')
      return {
        ...base,
        kind,
        categoryId: 'animals',
        options: indices.map((i) => {
          const animal = content.animals[i]!;
          return {
            kind: 'animal',
            id: animal.id,
            labelTt: animal.labelTt,
            image: animal.image,
          };
        }),
      };
    if (!objects.length)
      objects = shuffle(content.countObjects.map((_, i) => i));
    const object = content.countObjects[objects.shift()!]!;
    const illustration =
      object.kind === 'raster'
        ? { kind: 'raster' as const, id: object.id, image: object.image }
        : {
            kind: 'tinted' as const,
            id: object.id,
            image: object.image,
            hex: content.colors.find((color) => color.id === 'blue')!.hex,
          };
    return {
      ...base,
      kind: 'N1-A',
      categoryId: 'numbers',
      countObject: illustration,
      options: indices.map((i) => {
        const number = pool[i] as ContentV2['numbers'][number];
        return {
          kind: 'number',
          id: number.id,
          labelTt: number.labelTt,
          value: number.value,
        };
      }),
    };
  };
}
