import { describe, expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import {
  initialSeniorAdaptation,
  recordSeniorResult,
} from './senior-adaptation.ts';
import { allowedSeniorKinds, createSeniorPlanner } from './senior-planner.ts';
import type { ExerciseKind } from './exercise.ts';

describe('старшая адаптация', () => {
  it('независимо открывает уровни и повышает 4 → 5 → 6', () => {
    let state = initialSeniorAdaptation();
    for (let i = 0; i < 3; i++) state = recordSeniorResult(state, false, 'C1');
    expect(state).toEqual({
      answerCount: 4,
      correctCount: 3,
      streak: { kind: 'clean', count: 3 },
    });
    state = recordSeniorResult(state, false, 'C1');
    expect(state.answerCount).toBe(5);
    expect(state.streak).toBeNull();
    for (let i = 0; i < 5; i++) state = recordSeniorResult(state, false, 'C1');
    expect(state).toEqual({ answerCount: 6, correctCount: 9, streak: null });
    for (let i = 0; i < 30; i++) state = recordSeniorResult(state, false, 'C1');
    expect(state.streak).toEqual({ kind: 'clean', count: 5 });
  });
  it('понижает после двух упражнений с ошибками, насыщает нижнюю границу', () => {
    const state = { ...initialSeniorAdaptation(), answerCount: 6 as const };
    let next = recordSeniorResult(state, true, 'A1');
    expect(next.answerCount).toBe(6);
    next = recordSeniorResult(next, true, 'A1');
    expect(next.answerCount).toBe(5);
    expect(next.streak).toBeNull();
    for (let i = 0; i < 10; i++) next = recordSeniorResult(next, true, 'A1');
    expect(next.answerCount).toBe(4);
    expect(next.streak).toEqual({ kind: 'mistake', count: 2 });
    next = recordSeniorResult(next, false, 'A1');
    expect(next.streak).toEqual({ kind: 'clean', count: 1 });
    expect(state.correctCount).toBe(0);
  });
  it('N2 увеличивает correctCount и полностью пропускает обе серии', () => {
    for (const kind of ['clean', 'mistake'] as const) {
      const before = {
        ...initialSeniorAdaptation(),
        streak: { kind, count: kind === 'clean' ? 3 : 1 },
      };
      for (const mistakes of [false, true]) {
        const after = recordSeniorResult(before, mistakes, 'N2');
        expect(after.streak).toBe(before.streak);
        expect(after.answerCount).toBe(4);
        expect(after.correctCount).toBe(1);
      }
    }
  });
});
describe('выбор старшего упражнения', () => {
  it('пороги 3/8, отсутствие L3 у животных и исключение третьего повторения', () => {
    expect(allowedSeniorKinds('colors', 2, []).map((x) => x.kind)).toEqual([
      'C1',
      'C2',
    ]);
    expect(allowedSeniorKinds('colors', 3, []).map((x) => x.kind)).toContain(
      'C3-A',
    );
    expect(
      allowedSeniorKinds('numbers', 7, []).some((x) => x.difficulty === 3),
    ).toBe(false);
    expect(
      allowedSeniorKinds('numbers', 8, []).some((x) => x.difficulty === 3),
    ).toBe(true);
    expect(
      allowedSeniorKinds('animals', 100, []).every((x) => x.difficulty < 3),
    ).toBe(true);
    expect(
      allowedSeniorKinds('animals', 2, ['A1', 'A1']).map((x) => x.kind),
    ).toEqual(['A1']);
    expect(
      allowedSeniorKinds('animals', 3, ['A1', 'A1']).map((x) => x.kind),
    ).toEqual(['A2', 'A3']);
  });
  it('веса 40/35/25 и 8/7 выбираются по границам, виды внутри уровня равновероятны', () => {
    for (const [value, kind] of [
      [0, 'C1'],
      [0.3999, 'C1'],
      [0.4, 'C3-A'],
      [0.7499, 'C3-A'],
      [0.75, 'C4'],
      [0.9999, 'C4'],
    ] as const) {
      let first = true;
      const planner = createSeniorPlanner(contentV2, 'colors', () => {
        if (first) {
          first = false;
          return value;
        }
        return 0;
      });
      expect(
        planner.get({
          roundId: 1,
          optionCount: 4,
          correctCount: 8,
          recentKinds: [],
        }).kind,
      ).toBe(kind);
    }
    for (const value of [0.532, 0.534]) {
      let first = true;
      const planner = createSeniorPlanner(contentV2, 'animals', () => {
        if (first) {
          first = false;
          return value;
        }
        return 0;
      });
      expect(
        planner.get({
          roundId: 1,
          optionCount: 4,
          correctCount: 100,
          recentKinds: [],
        }).kind,
      ).toBe(value < 8 / 15 ? 'A1' : 'A2');
    }
  });
  it('готовый план повторяется без новой случайности; неверный порядок запрещён', () => {
    let calls = 0;
    const planner = createSeniorPlanner(contentV2, 'colors', () => {
      calls++;
      return 0.5;
    });
    const request = {
      roundId: 1,
      optionCount: 4 as const,
      correctCount: 0,
      recentKinds: [],
    };
    const first = planner.get(request),
      n = calls;
    expect(planner.get(request)).toBe(first);
    expect(calls).toBe(n);
    expect(() => planner.get({ ...request, roundId: 2 })).toThrow();
    expect(() => planner.get({ ...request, optionCount: 5 })).toThrow();
    planner.accept(99);
    expect(planner.get(request)).toBe(first);
    planner.accept(1);
    expect(planner.get({ ...request, roundId: 2 }).roundId).toBe(2);
  });
  it('прямые цели и формулировки проходят отдельные циклы без повтора на стыке', () => {
    const planner = createSeniorPlanner(contentV2, 'animals', () => 0.99);
    const targets: string[] = [];
    const recipes = new Map<string, Set<string>>();
    for (let roundId = 1; roundId <= 39 * 5; roundId++) {
      const plan = planner.get({
        roundId,
        optionCount: 6,
        correctCount: 0,
        recentKinds: [],
      });
      if (plan.kind !== 'A1') throw Error('Нет прямого вида');
      targets.push(plan.targetId);
      const seen = recipes.get(plan.targetId) ?? new Set();
      seen.add(plan.recipeId);
      recipes.set(plan.targetId, seen);
      planner.accept(roundId);
    }
    for (let i = 0; i < 5; i++)
      expect(new Set(targets.slice(i * 39, (i + 1) * 39)).size).toBe(39);
    expect(targets.every((id, i) => i === 0 || id !== targets[i - 1])).toBe(
      true,
    );
    expect([...recipes.values()].every((x) => x.size === 5)).toBe(true);
  });
  it('не выбирает третий одинаковый вид в длинной сессии', () => {
    for (const category of ['colors', 'animals', 'numbers'] as const) {
      const planner = createSeniorPlanner(contentV2, category, () => 0.6);
      let recentKinds: ExerciseKind[] = [];
      for (let roundId = 1; roundId < 80; roundId++) {
        const plan = planner.get({
          roundId,
          optionCount: 6,
          correctCount: roundId - 1,
          recentKinds,
        });
        if (roundId > 3)
          expect(
            [...recentKinds, plan.kind].every((x) => x === plan.kind),
          ).toBe(false);
        recentKinds = [...recentKinds, plan.kind].slice(-2);
        planner.accept(roundId);
      }
    }
  });
});
