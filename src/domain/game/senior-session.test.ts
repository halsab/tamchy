import { expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import { seniorExercise } from '../../../tests/fixtures/senior-exercises.ts';
import { createGame, gameReducer } from './reducer.ts';
import { getGameRequirements } from './requirements.ts';
import type { GameEventData, GameState } from './models.ts';
import type { ExerciseKind } from './exercise.ts';

const step = (s: GameState, e: GameEventData) =>
  gameReducer(s, { ...getGameRequirements(s).scope, ...e });
function ready(s: GameState, at: number) {
  const work = getGameRequirements(s).work;
  if (work.kind === 'prepare')
    for (const resource of work.resources)
      s = step(s, { type: 'RESOURCE_READY', resource, at });
  return step(s, { type: 'AUDIO_STARTED', at });
}
function solve(s: GameState, at: number) {
  s = ready(s, at);
  return step(s, {
    type: 'ANSWER',
    itemId: s.round.correctOptionId,
    at: at + 10,
  });
}
function next(s: GameState, kind: ExerciseKind, at: number) {
  s = step(step(s, { type: 'PAUSE' }), { type: 'CONTINUE', at });
  return step(s, {
    type: 'ROUND_GENERATED',
    round: seniorExercise(kind, s.round.id + 1, s.adaptation.answerCount),
    at,
  });
}
it('старшая сессия учитывает ответ один раз, сохраняет прогресс при сбоях и пропускает N2', () => {
  let state = createGame(
    'senior',
    { id: 'numbers', content: contentV2, mode: 'senior' },
    seniorExercise('N1-A'),
    0,
  );
  expect(state.adaptation.answerCount).toBe(4);
  for (const kind of ['N1-B', 'N1-C', 'N2'] as const) {
    state = solve(state, 100);
    state = next(state, kind, 200);
    expect(state.status).toBe('preparing');
  }
  expect(state.round.options).toHaveLength(2);
  const before = state.adaptation;
  state = ready(state, 300);
  const original = state.round;
  state = step(state, {
    type: 'ANSWER',
    itemId: state.round.options[1]!.id,
    at: 310,
  });
  state = step(state, { type: 'RETRY_DUE', at: 560 });
  state = ready(state, 570);
  expect(state.round).toBe(original);
  const scope = getGameRequirements(state).scope;
  state = step(state, {
    type: 'ANSWER',
    itemId: state.round.correctOptionId,
    at: 580,
  });
  expect(state.adaptation).toMatchObject({
    correctCount: 4,
    answerCount: 4,
    streak: before.streak,
  });
  expect(
    gameReducer(state, {
      ...scope,
      type: 'ANSWER',
      itemId: state.round.correctOptionId,
      at: 581,
    }),
  ).toBe(state);
  const accepted = state.adaptation;
  const work = getGameRequirements(state).work;
  if (work.kind !== 'prepare') throw Error('Нет подготовки подтверждения');
  state = step(state, {
    type: 'RESOURCE_FAILED',
    resource: work.resources[0]!,
    reason: 'load',
  });
  expect(state.adaptation).toBe(accepted);
  state = next(state, 'N1-A', 700);
  state = solve(state, 800);
  expect(state.adaptation).toMatchObject({
    correctCount: 5,
    answerCount: 5,
    streak: null,
  });
  const fresh = createGame(
    'new',
    { id: 'numbers', content: contentV2, mode: 'senior' },
    seniorExercise('N1-A'),
    0,
  );
  expect(fresh.adaptation).toEqual({
    answerCount: 4,
    correctCount: 0,
    streak: null,
  });
});
it('не принимает закрытый уровень, неправильное число ответов и третье повторение', () => {
  expect(() =>
    createGame(
      's',
      { id: 'colors', content: contentV2, mode: 'senior' },
      seniorExercise('C3-A'),
      0,
    ),
  ).toThrow();
  let state = createGame(
    's',
    { id: 'colors', content: contentV2, mode: 'senior' },
    seniorExercise('C1'),
    0,
  );
  state = solve(state, 10);
  state = step(step(state, { type: 'PAUSE' }), { type: 'CONTINUE', at: 30 });
  for (const round of [seniorExercise('C3-A', 2), seniorExercise('C2', 2, 6)])
    expect(step(state, { type: 'ROUND_GENERATED', round, at: 40 })).toBe(state);
  const generated = seniorExercise('C2', 2);
  const nextState = step(state, {
    type: 'ROUND_GENERATED',
    round: generated,
    at: 40,
  });
  expect(nextState.status).toBe('preparing');
  expect(nextState.round).not.toBe(generated);
  expect(nextState.round.prompt).not.toBe(generated.prompt);
});
it.each([4, 5])(
  'визуальное C3 в раунде %i сохраняет ожидание и уместную похвалу',
  (roundId) => {
    let state = createGame(
      's',
      { id: 'colors', content: contentV2, mode: 'senior' },
      seniorExercise('C1'),
      0,
    );
    for (let id = 2; id <= roundId; id++) {
      state = solve(state, id * 100);
      state = next(
        state,
        id === roundId ? 'C3-A' : id % 2 === 0 ? 'C2' : 'C1',
        id * 100 + 50,
      );
    }
    state = solve(state, 1000);
    const work = getGameRequirements(state).work;
    if (roundId % 2 === 0) {
      expect(work).toEqual({
        kind: 'wait',
        timer: { type: 'ADVANCE_DUE', at: 2210 },
      });
    } else {
      expect(work.kind).toBe('play');
      if (work.kind !== 'play') throw Error('Нет похвалы');
      expect(work.sequence).toEqual([
        'assets/audio/tt/interaction/very-good.mp3',
      ]);
      expect(work.optional).toBe(true);
      state = step(state, { type: 'AUDIO_STARTED', at: 1500 });
      state = step(state, { type: 'AUDIO_ENDED', at: 2200 });
      expect(getGameRequirements(state).work).toEqual({
        kind: 'wait',
        timer: { type: 'ADVANCE_DUE', at: 2500 },
      });
    }
    expect(step(state, { type: 'ADVANCE_DUE', at: 2000 })).toBe(state);
  },
);
