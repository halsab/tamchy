import { describe, expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import {
  seniorExercise,
  mutateExercise,
} from '../../../tests/fixtures/senior-exercises.ts';
import { validExercise } from './validate-exercise.ts';
import { roundResources } from './resources.ts';
import type { ExerciseKind } from '../../content/v2/types.ts';

const kinds = [
  'C1',
  'C2',
  'C3-A',
  'C3-B',
  'C4',
  'A1',
  'A2',
  'A3',
  'N1-A',
  'N1-B',
  'N1-C',
  'N2',
  'N3-A',
  'N3-B',
] as const;
const session = (kind: ExerciseKind) => ({
  sessionId: 'senior',
  mode: 'senior' as const,
  categoryId: seniorExercise(kind).categoryId,
  content: contentV2,
});
describe('старшая модель упражнения', () => {
  it.each(kinds)(
    '%s: принимает согласованные 4/5/6 ответов; N2 — два',
    (kind) => {
      for (const count of [4, 5, 6] as const) {
        // A2 с домашней целью использует только бесспорные дикие помехи.
        const round = seniorExercise(kind, 1, count);
        if (kind === 'A2')
          Object.assign(round, {
            options: contentV2.animals
              .filter((x) =>
                [
                  'animal-cat',
                  'animal-frog',
                  'animal-stork',
                  'animal-butterfly',
                  'animal-bear',
                  'animal-wolf',
                ].includes(x.id),
              )
              .slice(0, count)
              .map((x) => ({
                kind: 'animal',
                id: x.id,
                labelTt: x.labelTt,
                image: x.image,
              })),
          });
        if (kind === 'N2')
          Object.assign(round, { options: seniorExercise(kind).options });
        expect(validExercise(session(kind), round, count)).toBe(true);
      }
    },
  );
  it.each([
    [
      'C2',
      {
        prompt: {
          ...seniorExercise('C2').prompt,
          object: {
            kind: 'tinted',
            id: 'count-apple',
            image: 'assets/images/numbers/count-apple.webp',
            hex: '#D94343',
          },
        },
      },
    ],
    ['C1', { confirmation: { type: 'clip', clipId: 'color.blue' } }],
    ['C3-A', { confirmation: { type: 'sequence', clipIds: [] } }],
    ['A2', { prompt: { ...seniorExercise('A2').prompt, traitId: 'canSwim' } }],
    [
      'A3',
      { prompt: { ...seniorExercise('A3').prompt, animalId: 'animal-dog' } },
    ],
    [
      'C4',
      {
        prompt: {
          ...seniorExercise('C4').prompt,
          colorIds: ['red', 'blue', 'blue', 'red'],
        },
      },
    ],
    [
      'N1-A',
      {
        countObject: {
          kind: 'raster',
          id: 'count-apple',
          image: 'assets/images/numbers/count-apple.webp',
        },
      },
    ],
    ['N1-B', { prompt: { ...seniorExercise('N1-B').prompt, value: 11 } }],
    [
      'N3-A',
      { prompt: { ...seniorExercise('N3-A').prompt, left: 9, right: 2 } },
    ],
    [
      'N3-B',
      { prompt: { ...seniorExercise('N3-B').prompt, total: 3, removed: 3 } },
    ],
  ] satisfies [ExerciseKind, Record<string, unknown>][])(
    '%s: отклоняет несовместимые данные %j',
    (kind, patch) => {
      expect(
        validExercise(
          session(kind),
          mutateExercise(seniorExercise(kind), patch),
          4,
        ),
      ).toBe(false);
    },
  );
  it('требует картинки самого задания и все оттенки, без учебного аудио для визуального C3', () => {
    const object = seniorExercise('C2');
    expect(roundResources(session('C2'), object)).toContainEqual({
      kind: 'tinted-image',
      path: 'assets/images/shapes/shape-circle.png',
      hex: '#D94343',
    });
    const shape = seniorExercise('C3-A');
    const resources = roundResources(session('C3-A'), shape);
    expect(resources.filter((x) => x.kind === 'tinted-image')).toHaveLength(4);
    expect(resources.some((x) => x.kind === 'confirmation')).toBe(false);
    const silhouette = seniorExercise('A3');
    expect(
      roundResources(session('A3'), silhouette).filter(
        (x) => x.kind === 'image',
      ),
    ).toHaveLength(4);
  });
});

it('видимый текст задания соответствует полной аудиофразе', () => {
  const round = seniorExercise('N1-B');
  expect(
    validExercise(
      session('N1-B'),
      mutateExercise(round, {
        prompt: { ...round.prompt, textTt: 'Кызылны тап.' },
      }),
      4,
    ),
  ).toBe(false);
});
