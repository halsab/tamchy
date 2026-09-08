import { contentV2 as c } from '../../src/content/v2/catalog.ts';
import type {
  Exercise,
  SeniorExercise,
} from '../../src/domain/game/exercise.ts';
import type { ExerciseKind } from '../../src/content/v2/types.ts';

// Явные примеры для проверки контракта; игровые генераторы реализуются отдельно.
export function seniorExercise(
  kind: ExerciseKind,
  id = 1,
  count = kind === 'N2' ? 2 : 4,
): SeniorExercise {
  const color = c.colors[0]!;
  const object = {
    kind: 'tinted',
    id: 'shape-circle',
    image: 'assets/images/shapes/shape-circle.png',
    hex: color.hex,
  };
  const colorOptions = c.colors.slice(0, count).map((x) => ({
    kind: 'color',
    id: `color-${x.id}`,
    labelTt: x.labelTt,
    hex: x.hex,
  }));
  const animalIds = [
    'animal-cat',
    'animal-frog',
    'animal-stork',
    'animal-fish',
    'animal-horse',
    'animal-butterfly',
  ];
  const animalOptions = animalIds.slice(0, count).map((id) => {
    const x = c.animals.find((a) => a.id === id)!;
    return { kind: 'animal', id, labelTt: x.labelTt, image: x.image };
  });
  const numberOptions = [4, 3, 5, 2, 6, 7].slice(0, count).map((value) => {
    const x = c.numbers[value - 1]!;
    return { kind: 'number', id: x.id, labelTt: x.labelTt, value };
  });
  const base = {
    mode: 'senior',
    id,
    kind,
    difficulty: ['C3-A', 'C3-B', 'A2', 'A3', 'N2'].includes(kind)
      ? 2
      : ['C4', 'N3-A', 'N3-B'].includes(kind)
        ? 3
        : 1,
    categoryId: kind.startsWith('C')
      ? 'colors'
      : kind.startsWith('A')
        ? 'animals'
        : 'numbers',
    correctOptionId: kind.startsWith('C')
      ? 'color-red'
      : kind.startsWith('A')
        ? 'animal-cat'
        : 'number-4',
    confirmation: {
      type: 'clip',
      clipId: kind.startsWith('C')
        ? 'color.red'
        : kind.startsWith('A')
          ? 'animal.cat'
          : 'number.4',
    },
    options: kind.startsWith('C')
      ? colorOptions
      : kind.startsWith('A')
        ? animalOptions
        : numberOptions,
  };
  let prompt: Record<string, unknown> = { kind: 'spoken' };
  let parts: string[] = [];
  let ending = '.';
  switch (kind) {
    case 'C1':
      parts = ['color.red', 'colors.findTail'];
      break;
    case 'C2':
      prompt = { kind: 'tinted-object', object };
      parts = ['colors.objectColor.prompt'];
      ending = '?';
      break;
    case 'C3-A':
    case 'C3-B': {
      const sized = kind === 'C3-B';
      prompt = {
        kind: sized ? 'sized-shape-request' : 'shape-request',
        colorId: 'red',
        shapeId: 'circle',
        ...(sized ? { sizeId: 'big' } : {}),
      };
      parts = [
        ...(sized ? ['size.big'] : []),
        'color.red',
        'shape.circle.target',
        'common.find',
      ];
      Object.assign(base, {
        correctOptionId: 'shape-0',
        confirmation: { type: 'visual' },
        options: Array.from({ length: count }, (_, i) => ({
          kind: sized ? 'sized-shape' : 'shape',
          id: `shape-${i}`,
          labelTt: 'Түгәрәк',
          shapeId: i === 2 ? 'square' : 'circle',
          colorId: i < 3 ? (i === 1 ? 'blue' : 'red') : c.colors[i]!.id,
          ...(sized ? { sizeId: i === 3 ? 'small' : 'big' } : {}),
        })),
      });
      break;
    }
    case 'C4':
      prompt = {
        kind: 'color-sequence',
        pattern: 'ABAB',
        colorIds: ['red', 'blue', 'red', 'blue'],
      };
      parts = ['colors.sequence.prompt'];
      break;
    case 'A1':
      parts = ['animal.cat', 'common.where'];
      ending = '?';
      break;
    case 'A2':
      prompt = { kind: 'trait', traitId: 'domestic' };
      parts = ['animals.trait.domestic'];
      ending = '?';
      break;
    case 'A3':
      prompt = {
        kind: 'silhouette',
        animalId: 'animal-cat',
        image: c.animals[0]!.image,
      };
      parts = ['animals.silhouette.prompt'];
      ending = '?';
      break;
    case 'N1-A':
      parts = ['number.4', 'common.where'];
      ending = '?';
      break;
    case 'N1-B':
      prompt = { kind: 'quantity', value: 4, countObject: object };
      parts = ['common.howMany', 'shape.circle', 'common.has'];
      ending = '?';
      break;
    case 'N1-C':
      prompt = { kind: 'numeral', value: 4 };
      parts = ['common.whichIn', 'number.4', 'shape.circle', 'common.has'];
      ending = '?';
      Object.assign(base, {
        countObject: object,
        options: numberOptions.map((x) => ({ ...x, kind: 'group' })),
      });
      break;
    case 'N2':
      prompt = { kind: 'comparison', direction: 'more' };
      parts = ['numbers.more.prompt'];
      ending = '?';
      Object.assign(base, {
        countObject: object,
        options: [
          { kind: 'group', id: 'number-4', labelTt: 'Дүрт', value: 4 },
          { kind: 'group', id: 'number-1', labelTt: 'Бер', value: 1 },
        ],
      });
      break;
    case 'N3-A':
      prompt = { kind: 'addition', left: 1, right: 3, countObject: object };
      parts = ['common.totalHowMany', 'shape.circle'];
      ending = '?';
      break;
    case 'N3-B':
      prompt = {
        kind: 'subtraction',
        total: 7,
        removed: 3,
        countObject: object,
      };
      parts = ['common.howMany', 'shape.circle', 'common.left'];
      ending = '?';
      break;
  }
  const textTt =
    parts
      .map((id, i) => {
        const text = c.audio
          .find((x) => x.id === id)!
          .textTt.replace(/[.?!]+$/u, '');
        return i === 0 ? text : text.toLowerCase();
      })
      .join(' ') + ending;
  return {
    ...base,
    prompt: { ...prompt, textTt, audio: { type: 'sequence', clipIds: parts } },
  } as unknown as SeniorExercise;
}
export function mutateExercise(
  exercise: Exercise,
  patch: Record<string, unknown>,
): Exercise {
  return { ...JSON.parse(JSON.stringify(exercise)), ...patch } as Exercise;
}
