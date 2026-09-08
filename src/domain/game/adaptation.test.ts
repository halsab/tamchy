import { describe, expect, it } from 'vitest';
import { initialAdaptation, recordRoundResult } from './adaptation.ts';

describe('адаптация младшего режима', () => {
  it('начинает с двух и повышает после пяти чистых раундов на каждом шаге', () => {
    let state = initialAdaptation();
    for (const next of [3, 4]) {
      const before = state.answerCount;
      for (let i = 0; i < 4; i++) {
        state = recordRoundResult(state, false);
        expect(state.answerCount).toBe(before);
      }
      state = recordRoundResult(state, false);
      expect(state).toEqual({ answerCount: next, streak: null });
    }
    for (let i = 0; i < 5; i++) state = recordRoundResult(state, false);
    expect(state).toEqual({ answerCount: 4, streak: null });
    expect(initialAdaptation()).toEqual({ answerCount: 2, streak: null });
  });
  it('снижает только после двух завершённых раундов с ошибками', () => {
    const state = { ...initialAdaptation(), answerCount: 4 as const };
    let result = recordRoundResult(state, true);
    expect(result.answerCount).toBe(4);
    result = recordRoundResult(result, true);
    expect(result).toEqual({ answerCount: 3, streak: null });
    result = recordRoundResult(result, true);
    expect(result.answerCount).toBe(3);
    result = recordRoundResult(result, true);
    expect(result).toEqual({ answerCount: 2, streak: null });
    result = recordRoundResult(recordRoundResult(result, true), true);
    expect(result).toEqual({ answerCount: 2, streak: null });
  });
  it('противоположный результат сбрасывает прежнюю серию', () => {
    let state = initialAdaptation();
    for (let i = 0; i < 4; i++) state = recordRoundResult(state, false);
    state = recordRoundResult(state, true);
    expect(state).toEqual({
      answerCount: 2,
      streak: { kind: 'mistake', count: 1 },
    });
    state = recordRoundResult(state, false);
    expect(state).toEqual({
      answerCount: 2,
      streak: { kind: 'clean', count: 1 },
    });
    for (let i = 0; i < 3; i++) state = recordRoundResult(state, false);
    expect(state.answerCount).toBe(2);
    expect(recordRoundResult(state, false).answerCount).toBe(3);
  });
  it('не изменяет предыдущий результат', () => {
    const state = Object.freeze({
      answerCount: 3 as const,
      streak: Object.freeze({ kind: 'clean' as const, count: 4 }),
    });
    expect(recordRoundResult(state, false)).toEqual({
      answerCount: 4,
      streak: null,
    });
    expect(state.streak.count).toBe(4);
  });
});
