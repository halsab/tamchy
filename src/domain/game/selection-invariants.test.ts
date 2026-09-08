import { expect, it } from 'vitest';
import { createShuffledCycle, randomIndex, shuffle } from './random.ts';
import { findCompatibleAnimals, silhouettePairKey } from './silhouettes.ts';
import { contentV2 } from '../../content/v2/catalog.ts';
import { createSeniorPlanner } from './senior-planner.ts';
import type { ExerciseKind } from './exercise.ts';

it('случайность проверяет границы; цикл из одного элемента допустим, пустой и повторный запрещены', () => {
  for (const bad of [-0.1, 1, NaN, Infinity])
    expect(() => randomIndex(4, () => bad)).toThrow(RangeError);
  for (const length of [0, -1, 2.5])
    expect(() => randomIndex(length, () => 0)).toThrow(RangeError);
  expect(randomIndex(4, () => 0.999)).toBe(3);
  expect(shuffle([], () => 0)).toEqual([]);
  expect(() => createShuffledCycle([], () => 0)).toThrow();
  expect(() => createShuffledCycle([1, 1], () => 0)).toThrow();
  const single = createShuffledCycle([7], () => 0);
  expect(single()).toBe(7);
  expect(single()).toBe(7);
  const next = createShuffledCycle([1, 2], () => 0);
  expect([next(), next(), next(), next()]).toEqual([2, 1, 2, 1]);
  let n = 0;
  const changing = createShuffledCycle([1, 2], () =>
    n++ % 2 === 0 ? 0 : 0.99,
  );
  const values = Array.from({ length: 10 }, () => changing());
  expect(values.every((x, i) => i === 0 || values[i - 1] !== x)).toBe(true);
});
it('конечный поиск обходит тупиковую ветвь, проверяет пары помех и отклоняет невозможный пул', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  const forbidden = new Set([
    silhouettePairKey('b', 'c'),
    silhouettePairKey('b', 'd'),
    silhouettePairKey('b', 'e'),
  ]);
  expect(findCompatibleAnimals('a', 4, pool, forbidden)).toEqual([
    'a',
    'c',
    'd',
    'e',
  ]);
  expect(findCompatibleAnimals('a', 5, pool, forbidden)).toBeNull();
  expect(findCompatibleAnimals('a', 4, ['a', 'b', 'b'], new Set())).toBeNull();
  for (const [target, count] of [
    ['missing', 2],
    ['a', 0],
    ['a', 2.5],
  ] as const)
    expect(findCompatibleAnimals(target, count, pool, forbidden)).toBeNull();
});
it('все виды, числовые диапазоны и циклы покрываются детерминированной длинной сессией', () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const seen = new Set<ExerciseKind>();
  const objects: string[] = [];
  const traits: string[] = [];
  const patterns: string[] = [];
  const comparisons: string[] = [];
  const numberTargets = new Set<string>();
  for (const category of ['colors', 'animals', 'numbers'] as const) {
    const planner = createSeniorPlanner(contentV2, category, random);
    let recentKinds: ExerciseKind[] = [];
    for (let roundId = 1; roundId <= 1600; roundId++) {
      const p = planner.get({
        roundId,
        optionCount: 6,
        correctCount: roundId - 1,
        recentKinds,
      });
      seen.add(p.kind);
      if ('countObjectId' in p) objects.push(p.countObjectId);
      if (p.kind === 'A2') traits.push(p.traitId);
      if (p.kind === 'C4') patterns.push(p.pattern);
      if (p.kind === 'N1-A') numberTargets.add(p.targetId);
      if (p.kind === 'N2') {
        comparisons.push(p.direction);
        expect(p.optionCount).toBe(2);
        expect(Math.min(p.left, p.right)).toBeGreaterThanOrEqual(1);
        expect(Math.max(p.left, p.right)).toBeLessThanOrEqual(10);
        const difference = Math.abs(p.left - p.right);
        expect(difference).toBeGreaterThanOrEqual(roundId <= 8 ? 4 : 1);
        expect(difference).toBeLessThanOrEqual(6);
      }
      recentKinds = [...recentKinds, p.kind].slice(-2);
      planner.accept(roundId);
    }
  }
  expect(seen.size).toBe(14);
  expect(numberTargets.size).toBe(20);
  for (const [values, size] of [
    [objects, 13],
    [traits, 4],
    [patterns, 3],
    [comparisons, 2],
  ] as const) {
    for (let i = 0; i + size <= values.length; i += size)
      expect(new Set(values.slice(i, i + size)).size).toBe(size);
    expect(values.every((x, i) => i === 0 || x !== values[i - 1])).toBe(true);
  }
  expect(traits).not.toContain('canSwim');
});
it('планировщик отклоняет неверные запросы до расхода случайности', () => {
  let calls = 0;
  const planner = createSeniorPlanner(contentV2, 'colors', () => {
    calls++;
    return 0;
  });
  const request = {
    roundId: 1,
    optionCount: 4 as const,
    correctCount: 0,
    recentKinds: [],
  };
  for (const patch of [
    { roundId: 0 },
    { roundId: 1.5 },
    { correctCount: -1 },
    { correctCount: NaN },
    { recentKinds: ['A1'] as ExerciseKind[] },
    { recentKinds: ['C1', 'C1', 'C1'] as ExerciseKind[] },
  ])
    expect(() => planner.get({ ...request, ...patch })).toThrow();
  expect(calls).toBe(0);
});
