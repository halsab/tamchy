import { describe, expect, it } from 'vitest';
import { contentV2 as content } from '../../content/v2/catalog.ts';
import type { CategoryId, ContentV2 } from '../../content/types.ts';
import { audioClipIds, exerciseDefinitions } from './exercise.ts';
import type {
  ExerciseKind,
  SeniorAnswerCount,
  SeniorExercise,
} from './exercise.ts';
import type { SeniorRoundPlan } from './senior-planner.ts';
import {
  buildSeniorExercise,
  createSeniorExerciseGenerator,
} from './senior-exercises.ts';
import { validExercise } from './validate-exercise.ts';
import { silhouettePairKey } from './silhouettes.ts';

function seeded(seed = 71) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
function plan(
  kind: ExerciseKind,
  optionCount: SeniorAnswerCount = 6,
): SeniorRoundPlan {
  const base = {
    kind,
    roundId: 1,
    optionCount,
    difficulty: exerciseDefinitions[kind].difficulty,
  };
  switch (kind) {
    case 'C1':
      return { ...base, kind, targetId: 'red', recipeId: 'find' };
    case 'A1':
      return { ...base, kind, targetId: 'animal-cat', recipeId: 'where' };
    case 'N1-A':
      return { ...base, kind, targetId: 'number-20', recipeId: 'where' };
    case 'N1-B':
    case 'N1-C':
      return {
        ...base,
        kind,
        value: 10,
        countObjectId: 'count-apple',
        recipeId: content.recipes[kind][0]!.id,
      };
    case 'N3-A':
    case 'N3-B':
      return {
        ...base,
        kind,
        countObjectId: 'count-apple',
        recipeId: content.recipes[kind][0]!.id,
      };
    case 'N2':
      return {
        roundId: 1,
        optionCount: 2,
        difficulty: 2,
        kind,
        direction: 'more',
        left: 10,
        right: 1,
        countObjectId: 'count-apple',
      };
    case 'C4':
      return { ...base, kind, pattern: 'ABCABC' };
    case 'A2':
      return { ...base, kind, traitId: 'bird' };
    case 'A3':
      return { ...base, kind };
    default:
      return { ...base, kind };
  }
}
const kinds = Object.keys(exerciseDefinitions) as ExerciseKind[];

describe('полные генераторы S07–S09', () => {
  for (const count of [4, 5, 6] as const) {
    it(`все виды дают однозначные ${count} вариантов и известные учебные клипы`, () => {
      const random = seeded();
      for (const kind of kinds) {
        const positions = new Set<number>();
        for (let i = 0; i < 80; i++) {
          const exercise = buildSeniorExercise(
            content,
            plan(kind, count),
            random,
          );
          expect(
            validExercise(
              { content, categoryId: exercise.categoryId, mode: 'senior' },
              exercise,
              count,
            ),
            kind,
          ).toBe(true);
          expect(exercise.options).toHaveLength(kind === 'N2' ? 2 : count);
          expect(new Set(exercise.options.map((x) => x.id)).size).toBe(
            exercise.options.length,
          );
          for (const id of [
            ...audioClipIds(exercise.prompt.audio),
            ...audioClipIds(exercise.confirmation),
          ])
            expect(content.audio.some((x) => x.id === id)).toBe(true);
          positions.add(
            exercise.options.findIndex(
              (x) => x.id === exercise.correctOptionId,
            ),
          );
        }
        // N2 уже получил перемешанные стороны от планировщика.
        if (kind !== 'N2') expect(positions.size, kind).toBe(count);
      }
    });
  }
  it('C1/A1/N1-A сохраняют каждую цель и все её формулировки', () => {
    for (const kind of ['C1', 'A1', 'N1-A'] as const) {
      const pool =
        kind === 'C1'
          ? content.colors
          : kind === 'A1'
            ? content.animals
            : content.numbers;
      for (const target of pool)
        for (const recipe of content.recipes[kind]) {
          const exercise = buildSeniorExercise(
            content,
            {
              ...plan(kind),
              kind,
              targetId: target.id,
              recipeId: recipe.id,
            } as SeniorRoundPlan,
            seeded(),
          );
          expect(exercise.confirmation).toEqual({
            type: 'clip',
            clipId: target.labelClipId,
          });
          expect(exercise.correctOptionId).toBe(
            kind === 'C1' ? `color-${target.id}` : target.id,
          );
          expect('countObject' in exercise).toBe(false);
        }
    }
  });
  it('C2 достигает всех 12 нейтральных объектов и 13 точных цветов', () => {
    const objects = new Set<string>(),
      colors = new Set<string>();
    const random = seeded();
    for (let i = 0; i < 1000; i++) {
      const e = buildSeniorExercise(content, plan('C2'), random);
      if (e.kind !== 'C2') throw Error();
      objects.add(e.prompt.object.id);
      colors.add(e.prompt.object.hex);
      expect(e.options.find((x) => x.id === e.correctOptionId)?.hex).toBe(
        e.prompt.object.hex,
      );
    }
    expect([...objects].sort()).toEqual(
      content.countObjects
        .filter((x) => x.kind === 'tinted')
        .map((x) => x.id)
        .sort(),
    );
    expect([...colors].sort()).toEqual(content.colors.map((x) => x.hex).sort());
  });
  it('C3 содержит помеху для каждого отдельного признака, без уникального размера цели', () => {
    const shapes = new Set<string>(),
      sizes = new Set<string>();
    const random = seeded();
    for (const kind of ['C3-A', 'C3-B'] as const)
      for (let i = 0; i < 150; i++) {
        const e = buildSeniorExercise(content, plan(kind, 4), random);
        if (e.kind !== 'C3-A' && e.kind !== 'C3-B') throw Error();
        const p = e.prompt;
        shapes.add(p.shapeId);
        expect(
          e.options.some(
            (x) => x.colorId === p.colorId && x.shapeId !== p.shapeId,
          ),
        ).toBe(true);
        expect(
          e.options.some(
            (x) => x.shapeId === p.shapeId && x.colorId !== p.colorId,
          ),
        ).toBe(true);
        if (e.kind === 'C3-B') {
          sizes.add(e.prompt.sizeId);
          expect(
            e.options.some(
              (x) =>
                x.shapeId === p.shapeId &&
                x.colorId === p.colorId &&
                x.sizeId !== e.prompt.sizeId,
            ),
          ).toBe(true);
          expect(
            e.options.filter((x) => x.sizeId === e.prompt.sizeId).length,
          ).toBeGreaterThan(1);
        }
      }
    expect(shapes.size).toBe(6);
    expect(sizes.size).toBe(2);
  });
  it('C4 строит только три заданных ряда без внутренних пропусков', () => {
    for (const pattern of ['ABAB', 'AABAAB', 'ABCABC'] as const) {
      const e = buildSeniorExercise(
        content,
        { ...plan('C4'), kind: 'C4', pattern } as SeniorRoundPlan,
        seeded(),
      );
      if (e.kind !== 'C4') throw Error();
      const letters = new Map<string, string>();
      [...pattern].forEach((letter, i) => {
        const color = e.prompt.colorIds[i]!;
        if (letters.has(letter)) expect(color).toBe(letters.get(letter));
        letters.set(letter, color);
      });
      expect(new Set(letters.values()).size).toBe(letters.size);
      expect(e.correctOptionId).toBe(`color-${e.prompt.colorIds[0]}`);
    }
  });
  it('C3-B не подсказывает ответ наиболее частым размером', () => {
    const random = seeded();
    const majority = new Set<boolean>();
    for (const count of [4, 5, 6] as const)
      for (let i = 0; i < 80; i++) {
        const e = buildSeniorExercise(content, plan('C3-B', count), random);
        if (e.kind !== 'C3-B') throw Error();
        const matching = e.options.filter(
          (x) => x.sizeId === e.prompt.sizeId,
        ).length;
        expect(Math.abs(matching - (count - matching))).toBeLessThanOrEqual(1);
        if (count === 5) majority.add(matching > count / 2);
      }
    expect(majority.size).toBe(2);
  });
  it('A2 использует только yes/no и отклоняет отключённый либо невозможный вопрос', () => {
    for (const trait of content.animalTraits.traits.filter(
      (x) => x.generation === 'enabled',
    )) {
      for (const count of [4, 5, 6] as const) {
        const p = {
          ...plan('A2', count),
          kind: 'A2',
          traitId: trait.id,
        } as SeniorRoundPlan;
        const e = buildSeniorExercise(content, p, seeded());
        const values = e.options.map(
          (x) =>
            content.animalTraits.animals.find((a) => a.animalId === x.id)!
              .values[trait.id],
        );
        expect(values.filter((x) => x === 'yes')).toHaveLength(1);
        expect(values.filter((x) => x === 'no')).toHaveLength(count - 1);
      }
    }
    expect(() =>
      buildSeniorExercise(
        content,
        { ...plan('A2'), traitId: 'canSwim' } as SeniorRoundPlan,
        seeded(),
      ),
    ).toThrow();
    const broken: ContentV2 = {
      ...content,
      animalTraits: {
        ...content.animalTraits,
        animals: content.animalTraits.animals.map((x) => ({
          ...x,
          values: { ...x.values, bird: 'yes' },
        })),
      },
    };
    expect(() => buildSeniorExercise(broken, plan('A2'), seeded())).toThrow();
  });
  it('A3 конечным поиском исключает конфликт любой пары; все 39 целей достижимы', () => {
    const random = seeded(),
      targets = new Set<string>();
    const forbidden = new Set(
      content.silhouetteConflicts.pairs.map((x) =>
        silhouettePairKey(...x.animalIds),
      ),
    );
    for (let i = 0; i < 500; i++) {
      const e = buildSeniorExercise(content, plan('A3'), random);
      if (e.kind !== 'A3') throw Error();
      targets.add(e.prompt.animalId);
      expect(e.options.find((x) => x.id === e.correctOptionId)?.image).toBe(
        e.prompt.image,
      );
      for (const a of e.options)
        for (const b of e.options)
          expect(forbidden.has(silhouettePairKey(a.id, b.id))).toBe(false);
    }
    expect(targets.size).toBe(39);
    const broken = { ...content, animals: content.animals.slice(0, 3) };
    expect(() => buildSeniorExercise(broken, plan('A3'), seeded())).toThrow();
  });
  it('числовые помехи близкие, уникальные и в своём диапазоне; все 13 объектов используются', () => {
    const random = seeded();
    for (const kind of ['N1-A', 'N1-B', 'N1-C'] as const)
      for (let value = 1; value <= (kind === 'N1-A' ? 20 : 10); value++)
        for (const object of content.countObjects) {
          const p =
            kind === 'N1-A'
              ? { ...plan(kind), targetId: `number-${value}` }
              : { ...plan(kind), value, countObjectId: object.id };
          const e = buildSeniorExercise(content, p as SeniorRoundPlan, random);
          const values = e.options.map((x) => ('value' in x ? x.value : -1));
          const max = kind === 'N1-A' ? 20 : 10;
          const absent = Array.from({ length: max }, (_, i) => i + 1).filter(
            (x) => !values.includes(x),
          );
          expect(
            Math.max(...values.map((x) => Math.abs(x - value))),
          ).toBeLessThanOrEqual(
            Math.min(...absent.map((x) => Math.abs(x - value))),
          );
          if (e.kind === 'N1-B')
            expect(e.prompt.countObject.id).toBe(object.id);
          if (e.kind === 'N1-C') expect(e.countObject.id).toBe(object.id);
        }
  });
  it('N2 сохраняет стороны плана, два ответа и правильное больше/меньше', () => {
    for (const direction of ['more', 'less'] as const)
      for (const [left, right] of [
        [1, 10],
        [10, 1],
        [5, 6],
      ]) {
        const p = { ...plan('N2'), direction, left, right } as SeniorRoundPlan;
        const e = buildSeniorExercise(content, p, seeded());
        if (e.kind !== 'N2') throw Error();
        expect(e.options.map((x) => x.value)).toEqual([left, right]);
        expect(e.options.find((x) => x.id === e.correctOptionId)?.value).toBe(
          direction === 'more'
            ? Math.max(left!, right!)
            : Math.min(left!, right!),
        );
      }
  });
  it('N3 покрывает границы арифметики, не создаёт ноль и использует все объекты/рецепты', () => {
    const random = seeded(),
      sums = new Set<number>(),
      differences = new Set<number>();
    for (const kind of ['N3-A', 'N3-B'] as const)
      for (const object of content.countObjects)
        for (const recipe of content.recipes[kind])
          for (let i = 0; i < 25; i++) {
            const e = buildSeniorExercise(
              content,
              {
                ...plan(kind),
                kind,
                countObjectId: object.id,
                recipeId: recipe.id,
              } as SeniorRoundPlan,
              random,
            );
            if (e.kind !== 'N3-A' && e.kind !== 'N3-B') throw Error();
            const result =
              e.kind === 'N3-A'
                ? e.prompt.left + e.prompt.right
                : e.prompt.total - e.prompt.removed;
            (e.kind === 'N3-A' ? sums : differences).add(result);
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThanOrEqual(10);
            expect(
              e.options.find((x) => x.id === e.correctOptionId)?.value,
            ).toBe(result);
            expect(e.prompt.countObject.id).toBe(object.id);
            expect(audioClipIds(e.prompt.audio)).toContain(object.labelClipId);
          }
    expect([...sums].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect([...differences].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
  it('повтор get сохраняет весь раунд, помехи и случайность до accept', () => {
    for (const category of ['colors', 'animals', 'numbers'] as CategoryId[]) {
      let calls = 0;
      const random = seeded();
      const generator = createSeniorExerciseGenerator(content, category, () => {
        calls++;
        return random();
      });
      let recentKinds: ExerciseKind[] = [];
      for (let roundId = 1; roundId <= 100; roundId++) {
        const request = {
          roundId,
          optionCount: 6 as const,
          correctCount: roundId - 1,
          recentKinds,
        };
        const e: SeniorExercise = generator.get(request),
          before = calls;
        expect(generator.get(request)).toBe(e);
        expect(calls).toBe(before);
        generator.accept(roundId - 1);
        expect(generator.get(request)).toBe(e);
        expect(() =>
          generator.get({ ...request, roundId: roundId + 1 }),
        ).toThrow();
        generator.accept(roundId);
        recentKinds = [...recentKinds, e.kind].slice(-2);
      }
    }
  });
  it('невалидные планы и ссылки отклоняются до выдачи упражнения', () => {
    for (const patch of [
      { roundId: 0 },
      { optionCount: 3 },
      { difficulty: 3 },
      { targetId: 'missing' },
      { recipeId: 'missing' },
    ])
      expect(() =>
        buildSeniorExercise(
          content,
          { ...plan('C1'), ...patch } as SeniorRoundPlan,
          seeded(),
        ),
      ).toThrow();
    expect(() =>
      buildSeniorExercise(
        content,
        { ...plan('N2'), left: 1, right: 1 } as SeniorRoundPlan,
        seeded(),
      ),
    ).toThrow();
    expect(() =>
      buildSeniorExercise(
        content,
        { ...plan('N1-B'), countObjectId: 'missing' } as SeniorRoundPlan,
        seeded(),
      ),
    ).toThrow();
    expect(() =>
      buildSeniorExercise(
        { ...content, colors: content.colors.slice(0, 2) },
        plan('C1'),
        seeded(),
      ),
    ).toThrow();
  });
});
