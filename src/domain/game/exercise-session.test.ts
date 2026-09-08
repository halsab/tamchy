import type { Exercise } from './exercise.ts';
import { expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import { createExerciseGenerator } from './exercises.ts';
import { createGame, gameReducer } from './reducer.ts';
import { getGameRequirements } from './requirements.ts';
import type { GameEventData, GameState } from './models.ts';

function step(state: GameState, event: GameEventData) {
  return gameReducer(state, { ...getGameRequirements(state).scope, ...event });
}
function ready(state: GameState, at: number) {
  const work = getGameRequirements(state).work;
  if (work.kind === 'prepare')
    for (const resource of work.resources)
      state = step(state, { type: 'RESOURCE_READY', resource, at });
  return step(state, { type: 'AUDIO_STARTED', at: at + 1 });
}
it('полная сессия v2 меняет число вариантов только в следующем упражнении', () => {
  const category = { id: 'colors' as const, content: contentV2 };
  const generate = createExerciseGenerator(contentV2, 'colors', () => 0.5);
  let state = createGame('junior', category, generate(2), 0);
  const sizes = [];
  const mistakes = [...Array<boolean>(10).fill(false), true, true, true, true];
  for (const [index, wrong] of mistakes.entries()) {
    const at = index * 5000;
    state = ready(state, at + 10);
    sizes.push(state.round.options.length);
    const original = state.round;
    if (wrong) {
      state = step(state, {
        type: 'ANSWER',
        itemId: state.round.options.find(
          (x) => x.id !== state.round.correctOptionId,
        )!.id,
        at: at + 20,
      });
      state = step(state, { type: 'RETRY_DUE', at: at + 270 });
      state = ready(state, at + 280);
    }
    state = step(state, {
      type: 'ANSWER',
      itemId: state.round.correctOptionId,
      at: at + 300,
    });
    expect(state.round).toBe(original);
    state = ready(state, at + 310);
    state = step(state, { type: 'AUDIO_ENDED', at: at + 350 });
    state = step(state, { type: 'ADVANCE_DUE', at: at + 1500 });
    const work = getGameRequirements(state).work;
    expect(work.kind).toBe('next-round');
    if (work.kind !== 'next-round') throw new Error('Нет перехода');
    const round = generate(work.optionCount);
    state = step(state, { type: 'ROUND_GENERATED', round, at: at + 1510 });
    expect(state.status).toBe('preparing');
  }
  expect(sizes).toEqual([2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 3, 3]);
  expect(state.round.options).toHaveLength(2);
  expect(state.adaptation.answerCount).toBe(2);
});
it('подготовка требует все части фразы и название, неверное число ответов отклоняется', () => {
  const category = { id: 'animals' as const, content: contentV2 };
  const generate = createExerciseGenerator(contentV2, 'animals', () => 0.99);
  const exercise = generate(2);
  const state = createGame('all-clips', category, exercise, 0);
  const work = getGameRequirements(state).work;
  expect(work.kind).toBe('prepare');
  if (work.kind !== 'prepare') throw new Error('Нет подготовки');
  expect(work.resources.filter((x) => x.kind === 'prompt')).toHaveLength(2);
  expect(work.resources.some((x) => x.kind === 'confirmation')).toBe(true);
  expect(() =>
    createGame(
      'bad',
      category,
      { ...exercise, options: exercise.options.slice(0, 1) } as Exercise,
      0,
    ),
  ).toThrow();
});
