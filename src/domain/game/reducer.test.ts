import { describe, expect, it } from 'vitest';
import {
  gameCategories as categories,
  categoryIds,
} from '../../../tests/helpers/game-content.ts';
import { audioResource, isImageResource } from './resources.ts';
import type {
  GameEvent,
  GameEventData,
  GameState,
  Resource,
  Round,
} from './models.ts';
import { createGame, gameReducer, hasHint } from './reducer.ts';
import { createRoundGenerator } from './rounds.ts';
import { getGameRequirements } from './requirements.ts';

function setup(categoryIndex = 0) {
  const selected = categories[categoryIndex]!;
  const generate = createRoundGenerator(selected, () => 0.5);
  return { state: createGame('session-1', selected, generate(), 0), generate };
}

function event(state: GameState, body: GameEventData): GameEvent {
  return {
    sessionId: state.session.sessionId,
    roundId: state.round.id,
    operationId: state.operationId,
    ...body,
  };
}

function step(state: GameState, body: GameEventData) {
  return gameReducer(freeze(state), freeze(event(state, body)));
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function ready(state: GameState, at = 10): GameState {
  let next = state;
  if (state.status === 'preparing' && state.stage === 'resources') {
    for (const resource of state.pending)
      next = step(next, { type: 'RESOURCE_READY', resource, at });
  } else if (state.status === 'correct') {
    next = step(next, { type: 'RESOURCE_READY', resource: label(state), at });
  }
  return next;
}

function begin(state = setup().state, at = 20) {
  return step(ready(state, at - 1), { type: 'AUDIO_STARTED', at });
}

function label(state: GameState): Resource {
  return audioResource(state.session, state.round, 'confirmation');
}
function prompt(state: GameState): Resource {
  return audioResource(state.session, state.round, 'prompt');
}

function answer(state: GameState, at = 100, correct = true) {
  return step(state, {
    type: 'ANSWER',
    itemId: correct
      ? state.round.correctOptionId
      : state.round.options
          .map((option) => option.id)
          .find((id) => id !== state.round.correctOptionId)!,
    at,
  });
}

function confirmed(state = answer(begin()), endedAt = 500) {
  return step(step(ready(state, 110), { type: 'AUDIO_STARTED', at: 120 }), {
    type: 'AUDIO_ENDED',
    at: endedAt,
  });
}

describe('подготовка и ответы', () => {
  it.each([0, 1, 2])(
    'раздел %s: нужны все ресурсы и фактическое начало задания',
    (index) => {
      let { state } = setup(index);
      expect(state.status).toBe('preparing');
      expect(answer(state)).toBe(state);
      expect(step(state, { type: 'AUDIO_STARTED', at: 1 })).toBe(state);
      if (state.status !== 'preparing' || state.stage !== 'resources')
        throw new Error('Нет подготовки');
      const pending = state.pending;
      expect(pending.filter(isImageResource)).toHaveLength(
        index === 1 ? 2 : index === 2 ? 1 : 0,
      );
      expect(pending).toContainEqual(prompt(state));
      for (const resource of pending) {
        expect(answer(state)).toBe(state);
        state = step(state, { type: 'RESOURCE_READY', resource, at: 10 });
      }
      expect(state).toMatchObject({ status: 'preparing', stage: 'prompt' });
      expect(answer(state)).toBe(state);
      expect(step(state, { type: 'AUDIO_ENDED', at: 15 })).toBe(state);
      state = step(state, { type: 'AUDIO_STARTED', at: 20 });
      expect(state.status).toBe('awaiting');
      expect(answer(state).status).toBe('correct');
    },
  );

  it('правильный ответ блокирует повторы и принимает только первое нажатие', () => {
    const waiting = begin();
    const correct = answer(waiting);
    expect(correct).toMatchObject({
      status: 'correct',
      acceptedAt: 100,
      confirmation: { status: 'loading', requestedAt: 100 },
    });
    expect(correct.operationId).toBeGreaterThan(waiting.operationId);
    expect(step(correct, { type: 'REPEAT', at: 101 })).toBe(correct);
    expect(answer(correct, 102)).toBe(correct);
    expect(answer(correct, 103, false)).toBe(correct);
    expect(step(correct, { type: 'AUDIO_ENDED', at: 150 })).toBe(correct);
    expect(
      gameReducer(correct, event(waiting, { type: 'AUDIO_ENDED', at: 150 })),
    ).toBe(correct);
  });

  it.each([
    { endedAt: 200, boundary: 1300 },
    { endedAt: 2000, boundary: 2300 },
  ])(
    'обе временные границы: подтверждение закончилось в $endedAt',
    ({ endedAt, boundary }) => {
      const correct = confirmed(answer(begin(), 100), endedAt);
      expect(step(correct, { type: 'ADVANCE_DUE', at: boundary - 1 })).toBe(
        correct,
      );
      const next = step(correct, { type: 'ADVANCE_DUE', at: boundary });
      expect(next).toMatchObject({ status: 'transitioning', acceptedAt: 100 });
      expect(step(next, { type: 'ADVANCE_DUE', at: boundary + 1 })).toBe(next);
      expect(step(next, { type: 'AUDIO_ENDED', at: boundary + 2 })).toBe(next);
    },
  );

  it('одних 1200 мс недостаточно без подтверждения; завершение не принимается до старта', () => {
    const correct = answer(begin());
    expect(step(correct, { type: 'ADVANCE_DUE', at: 9000 })).toBe(correct);
    const starting = ready(correct, 110);
    expect(step(starting, { type: 'AUDIO_ENDED', at: 500 })).toBe(starting);
    const playing = step(starting, { type: 'AUDIO_STARTED', at: 120 });
    expect(step(playing, { type: 'ADVANCE_DUE', at: 9000 })).toBe(playing);
    const ended = step(playing, { type: 'AUDIO_ENDED', at: 10000 });
    expect(step(ended, { type: 'AUDIO_ENDED', at: 20000 })).toBe(ended);
    expect(step(ended, { type: 'ADVANCE_DUE', at: 10300 }).status).toBe(
      'transitioning',
    );
  });

  it('две ошибки сохраняют раунд, дают подсказку и не отвечают автоматически', () => {
    const initial = begin();
    let state = initial;
    expect(hasHint(state)).toBe(false);
    for (let count = 1; count <= 2; count++) {
      const at = count * 1000;
      const wrong = answer(state, at, false);
      expect(wrong).toMatchObject({
        status: 'retrying',
        mistakes: count,
        retryAt: at + 250,
      });
      expect(wrong.round).toEqual(initial.round);
      expect(answer(wrong, at + 1, false)).toBe(wrong);
      expect(step(wrong, { type: 'REPEAT', at: at + 2 })).toBe(wrong);
      expect(step(wrong, { type: 'RETRY_DUE', at: at + 249 })).toBe(wrong);
      state = step(wrong, { type: 'RETRY_DUE', at: at + 250 });
      expect(state).toMatchObject({ status: 'preparing', stage: 'prompt' });
      expect(hasHint(state)).toBe(count === 2);
      expect(answer(state, at + 251)).toBe(state);
      state = step(state, { type: 'AUDIO_STARTED', at: at + 260 });
    }
    expect(state.round).toEqual(initial.round);
    expect(state.status).toBe('awaiting');
    expect(hasHint(answer(state, 3000))).toBe(false);
  });

  it('неподходящий ID и повторная оценка reducer не меняют входные данные', () => {
    const state = begin();
    const before = structuredClone(state);
    const action = event(state, {
      type: 'ANSWER',
      itemId: state.round.correctOptionId,
      at: 100,
    });
    Object.freeze(action);
    Object.freeze(state.round.options);
    Object.freeze(state.round);
    Object.freeze(state.session.content);
    Object.freeze(state.session);
    Object.freeze(state);
    expect(step(state, { type: 'ANSWER', itemId: 'animal-cat', at: 100 })).toBe(
      state,
    );
    expect(gameReducer(state, action)).toEqual(gameReducer(state, action));
    expect(state).toEqual(before);
  });

  it('подсказка сохраняется при ошибке ресурса и паузе до принятого ответа', () => {
    let state = begin();
    for (let index = 0; index < 2; index++) {
      state = answer(state, 1000 + index * 1000, false);
      state = step(state, { type: 'RETRY_DUE', at: 1250 + index * 1000 });
      state = step(state, { type: 'AUDIO_STARTED', at: 1300 + index * 1000 });
    }
    const failed = step(state, {
      type: 'RESOURCE_FAILED',
      resource: prompt(state),
      reason: 'decode',
    });
    expect(hasHint(failed)).toBe(true);
    expect(hasHint(step(failed, { type: 'PAUSE' }))).toBe(true);
    expect(hasHint(step(state, { type: 'PAUSE' }))).toBe(true);
    const correct = answer(state, 3000);
    expect(hasHint(correct)).toBe(false);
    expect(hasHint(step(correct, { type: 'PAUSE' }))).toBe(false);
    expect(
      hasHint(
        step(correct, {
          type: 'RESOURCE_FAILED',
          resource: label(correct),
          reason: 'load',
        }),
      ),
    ).toBe(false);
    expect(hasHint(step(state, { type: 'EXIT' }))).toBe(false);
  });
});

describe('повтор и бездействие', () => {
  it('каждый ручной повтор заменяет операцию, не образуя очередь', () => {
    const initial = begin();
    const first = step(initial, { type: 'REPEAT', at: 100 });
    const second = step(first, { type: 'REPEAT', at: 101 });
    expect(second).toMatchObject({
      status: 'preparing',
      stage: 'prompt',
      round: initial.round,
    });
    expect(second.operationId).toBeGreaterThan(first.operationId);
    for (const previous of [initial, first]) {
      for (const type of ['AUDIO_STARTED', 'AUDIO_ENDED'] as const) {
        expect(gameReducer(second, event(previous, { type, at: 200 }))).toBe(
          second,
        );
      }
    }
    expect(step(second, { type: 'AUDIO_STARTED', at: 200 }).status).toBe(
      'awaiting',
    );
  });

  it('один автоматический повтор через 10 секунд; ручные повторы не сбрасывают лимит', () => {
    const playing = begin();
    expect(step(playing, { type: 'IDLE_DUE', at: 50000 })).toBe(playing);
    const ended = step(playing, { type: 'AUDIO_ENDED', at: 500 });
    expect(step(ended, { type: 'IDLE_DUE', at: 10499 })).toBe(ended);
    const repeated = step(ended, { type: 'IDLE_DUE', at: 10500 });
    expect(repeated).toMatchObject({
      status: 'preparing',
      stage: 'prompt',
      reminderUsed: true,
    });
    expect(
      gameReducer(repeated, event(ended, { type: 'IDLE_DUE', at: 10501 })),
    ).toBe(repeated);
    let state = step(repeated, { type: 'AUDIO_STARTED', at: 10600 });
    state = step(state, { type: 'AUDIO_ENDED', at: 11000 });
    expect(step(state, { type: 'IDLE_DUE', at: 99000 })).toBe(state);
    state = step(state, { type: 'REPEAT', at: 100000 });
    state = step(state, { type: 'AUDIO_STARTED', at: 100100 });
    state = step(state, { type: 'AUDIO_ENDED', at: 100500 });
    expect(step(state, { type: 'IDLE_DUE', at: 999999 })).toBe(state);
    expect(state.round).toEqual(playing.round);
    expect(state.status).toBe('awaiting');
  });

  it('действие снимает текущий таймер, дубликат окончания его не возвращает', () => {
    const ended = step(begin(), { type: 'AUDIO_ENDED', at: 500 });
    const active = step(ended, { type: 'ACTIVITY' });
    expect(step(active, { type: 'IDLE_DUE', at: 10500 })).toBe(active);
    expect(step(active, { type: 'AUDIO_ENDED', at: 600 })).toBe(active);
    expect(step(active, { type: 'ACTIVITY' })).toBe(active);
    expect(active.reminderUsed).toBe(false);
    const repeated = step(active, { type: 'REPEAT', at: 11000 });
    expect(
      gameReducer(repeated, event(ended, { type: 'IDLE_DUE', at: 12000 })),
    ).toBe(repeated);
    const finished = step(
      step(repeated, { type: 'AUDIO_STARTED', at: 11010 }),
      { type: 'AUDIO_ENDED', at: 11500 },
    );
    expect(step(finished, { type: 'IDLE_DUE', at: 21500 }).reminderUsed).toBe(
      true,
    );
  });
});

describe('пауза, выход и следующий раунд', () => {
  it.each(['resources', 'prompt', 'playing', 'ended', 'retrying'] as const)(
    'пауза до ответа в фазе %s сохраняет раунд',
    (phase) => {
      let state = setup(1).state;
      if (phase !== 'resources') state = ready(state);
      if (phase === 'playing' || phase === 'ended' || phase === 'retrying')
        state = begin(state);
      if (phase === 'ended')
        state = step(state, { type: 'AUDIO_ENDED', at: 50 });
      if (phase === 'retrying') state = answer(state, 100, false);
      const paused = step(state, { type: 'PAUSE' });
      expect(paused.status).toBe('paused');
      expect(paused.operationId).toBeGreaterThan(state.operationId);
      expect(step(paused, { type: 'RETURN' })).toBe(paused);
      expect(step(paused, { type: 'PAUSE' })).toBe(paused);
      expect(step(paused, { type: 'AUDIO_STARTED', at: 200 })).toBe(paused);
      expect(answer(paused)).toBe(paused);
      expect(
        gameReducer(paused, event(state, { type: 'AUDIO_ENDED', at: 200 })),
      ).toBe(paused);
      const continued = step(paused, { type: 'CONTINUE', at: 300 });
      expect(continued).toMatchObject({
        status: 'preparing',
        stage: 'resources',
        round: state.round,
        mistakes: state.mistakes,
      });
      expect(answer(continued)).toBe(continued);
      expect(begin(continued, 320).status).toBe('awaiting');
    },
  );

  it.each([
    'loading',
    'starting',
    'playing',
    'ended',
    'transitioning',
  ] as const)(
    'продолжение после правильного ответа в фазе %s даёт один переход',
    (phase) => {
      const { generate } = setup();
      let state = answer(begin());
      if (phase !== 'loading') state = ready(state, 110);
      if (phase === 'playing' || phase === 'ended' || phase === 'transitioning')
        state = step(state, { type: 'AUDIO_STARTED', at: 120 });
      if (phase === 'ended' || phase === 'transitioning')
        state = step(state, { type: 'AUDIO_ENDED', at: 200 });
      if (phase === 'transitioning')
        state = step(state, { type: 'ADVANCE_DUE', at: 1300 });
      const paused = step(state, { type: 'PAUSE' });
      expect(step(paused, { type: 'RETURN' })).toBe(paused);
      const continued = step(paused, { type: 'CONTINUE', at: 2000 });
      expect(continued).toMatchObject({
        status: 'transitioning',
        acceptedAt: 100,
      });
      expect(step(continued, { type: 'CONTINUE', at: 2001 })).toBe(continued);
      expect(answer(continued)).toBe(continued);
      const generated = event(continued, {
        type: 'ROUND_GENERATED',
        round: generate(state.adaptation.answerCount),
        at: 2010,
      });
      const next = gameReducer(continued, generated);
      expect(next).toMatchObject({
        status: 'preparing',
        round: { id: 2 },
        mistakes: 0,
        reminderUsed: false,
      });
      expect(gameReducer(next, generated)).toBe(next);
      expect(
        gameReducer(next, event(state, { type: 'AUDIO_ENDED', at: 2500 })),
      ).toBe(next);
    },
  );

  it('напоминание остаётся использованным после пауз, ошибок и продолжения', () => {
    let state = step(begin(), { type: 'AUDIO_ENDED', at: 100 });
    state = step(state, { type: 'IDLE_DUE', at: 10100 });
    for (let index = 0; index < 3; index++) {
      state = step(state, { type: 'PAUSE' });
      state = step(state, { type: 'CONTINUE', at: 20000 + index * 20000 });
      state = begin(state, 20100 + index * 20000);
      state = answer(state, 20200 + index * 20000, false);
      state = step(state, { type: 'RETRY_DUE', at: 20450 + index * 20000 });
      state = step(state, { type: 'AUDIO_STARTED', at: 20500 + index * 20000 });
      state = step(state, { type: 'AUDIO_ENDED', at: 20600 + index * 20000 });
      expect(step(state, { type: 'IDLE_DUE', at: 30600 + index * 20000 })).toBe(
        state,
      );
    }
    expect(state).toMatchObject({
      status: 'awaiting',
      reminderUsed: true,
      mistakes: 3,
      round: { id: 1 },
    });
  });

  it('выход доступен из всех фаз и поздние события не восстанавливают сессию', () => {
    const initial = setup().state;
    const waiting = begin(initial);
    const states = [
      initial,
      ready(initial),
      waiting,
      answer(waiting, 100, false),
      answer(waiting),
      confirmed(),
      step(confirmed(), { type: 'ADVANCE_DUE', at: 1300 }),
      step(waiting, { type: 'PAUSE' }),
      step(initial, {
        type: 'RESOURCE_FAILED',
        resource: prompt(initial),
        reason: 'load',
      }),
    ];
    for (const state of states) {
      const ended = step(state, { type: 'EXIT' });
      expect(ended.status).toBe('ended');
      expect(ended.operationId).toBeGreaterThan(state.operationId);
      for (const body of [
        { type: 'RESOURCE_READY', resource: prompt(state), at: 1000 },
        { type: 'AUDIO_STARTED', at: 1000 },
        { type: 'AUDIO_ENDED', at: 1000 },
        { type: 'CONTINUE', at: 1000 },
        { type: 'RETRY', at: 1000 },
        { type: 'EXIT' },
      ] satisfies GameEventData[]) {
        expect(gameReducer(ended, event(state, body))).toBe(ended);
        expect(step(ended, body)).toBe(ended);
      }
    }
  });

  it('следующий раунд принимается только в переходе, с нужным ID и корректными вариантами', () => {
    const { state: initial, generate } = setup();
    const nextRound = generate();
    expect(
      step(begin(initial), {
        type: 'ROUND_GENERATED',
        round: nextRound,
        at: 500,
      }),
    ).toEqual(begin(initial));
    const transition = step(confirmed(answer(begin(initial))), {
      type: 'ADVANCE_DUE',
      at: 1300,
    });
    for (const round of [
      initial.round,
      { ...nextRound, id: 3 },
      { ...nextRound, categoryId: 'animals' } as Round,
      {
        ...nextRound,
        options: [nextRound.options[0]!, nextRound.options[0]!],
      },
      {
        ...nextRound,
        options: [
          nextRound.options[0]!,
          { ...nextRound.options[1]!, id: 'animal-cat' },
        ],
      },
      { ...nextRound, correctOptionId: 'unknown' },
      {
        ...nextRound,
        correctOptionId: initial.round.correctOptionId,
        options: initial.round.options,
      },
    ])
      expect(
        step(transition, {
          type: 'ROUND_GENERATED',
          round: round as Round,
          at: 1400,
        }),
      ).toBe(transition);
    const action = event(transition, {
      type: 'ROUND_GENERATED',
      round: nextRound,
      at: 1400,
    });
    const next = gameReducer(transition, action);
    expect(next.round).toEqual(nextRound);
    expect(gameReducer(transition, action)).toEqual(next);
    expect(gameReducer(next, action)).toBe(next);
    expect(next.round.options).not.toBe(nextRound.options);
    expect(next.round.options[0]).not.toBe(nextRound.options[0]);
  });

  it('отклоняет недопустимый первый раунд и копирует данные сессии', () => {
    const category = structuredClone(categories[0]!);
    const generate = createRoundGenerator(category, () => 0);
    const first = generate();
    expect(() => createGame('s', category, { ...first, id: 2 }, 0)).toThrow();
    expect(() =>
      createGame('s', category, { ...first, correctOptionId: 'missing' }, 0),
    ).toThrow();
    const state = createGame('s', category, first, 0);
    expect(state.session.content).not.toBe(category.content);
    expect(state.session.content.audio[0]).not.toBe(category.content.audio[0]);
    expect(state.round).not.toBe(first);
    expect(state.round.options).not.toBe(first.options);
  });
});

describe('ошибки и восстановление', () => {
  it.each(['image', 'prompt'] as const)(
    'ошибка обязательного ресурса %s блокирует ответы до явного повтора',
    (kind) => {
      const initial = setup(1).state;
      if (initial.status !== 'preparing' || initial.stage !== 'resources')
        throw new Error('Нет подготовки');
      const resource = initial.pending.find(
        (resource) => resource.kind === kind,
      )!;
      const failed = step(initial, {
        type: 'RESOURCE_FAILED',
        resource,
        reason: 'load',
      });
      expect(failed).toMatchObject({
        status: 'error',
        failure: { phase: 'preparation', resource, reason: 'load' },
      });
      expect(answer(failed)).toBe(failed);
      expect(step(failed, { type: 'RESOURCE_READY', resource, at: 10 })).toBe(
        failed,
      );
      const retry = step(failed, { type: 'RETRY', at: 100 });
      expect(retry).toMatchObject({
        status: 'preparing',
        stage: 'resources',
        round: initial.round,
        requestedAt: 100,
      });
      expect(
        gameReducer(
          retry,
          event(initial, { type: 'RESOURCE_FAILED', resource, reason: 'load' }),
        ),
      ).toBe(retry);
      expect(begin(retry, 200).status).toBe('awaiting');
    },
  );

  it.each(['decode', 'blocked'] as const)(
    'ошибка задания %s сохраняет фазу и требует нового старта',
    (reason) => {
      const initial = ready(setup().state);
      const failed = step(initial, {
        type: 'RESOURCE_FAILED',
        resource: prompt(initial),
        reason,
      });
      expect(failed).toMatchObject({
        status: 'error',
        failure: { phase: 'prompt', reason },
      });
      const paused = step(failed, { type: 'PAUSE' });
      const restored = step(paused, { type: 'CONTINUE', at: 100 });
      expect(restored).toMatchObject({
        status: 'error',
        failure: { phase: 'prompt', reason },
      });
      const retry = step(restored, { type: 'RETRY', at: 200 });
      expect(retry).toMatchObject({ status: 'preparing', stage: 'resources' });
      expect(answer(retry)).toBe(retry);
      expect(begin(retry, 250).status).toBe('awaiting');
    },
  );

  it.each(['loading', 'starting', 'playing'] as const)(
    'ошибка подтверждения в фазе %s не отменяет и не засчитывает ответ второй раз',
    (phase) => {
      let correct = answer(begin());
      if (phase !== 'loading') correct = ready(correct, 110);
      if (phase === 'playing')
        correct = step(correct, { type: 'AUDIO_STARTED', at: 120 });
      const failed = step(correct, {
        type: 'RESOURCE_FAILED',
        resource: label(correct),
        reason: 'decode',
      });
      expect(failed).toMatchObject({
        status: 'error',
        failure: {
          phase: 'confirmation',
          acceptedAt: 100,
          resource: label(correct),
        },
      });
      expect(answer(failed, 200)).toBe(failed);
      expect(step(failed, { type: 'ADVANCE_DUE', at: 5000 })).toBe(failed);
      let retry = step(failed, { type: 'RETRY', at: 5000 });
      expect(retry).toMatchObject({
        status: 'correct',
        acceptedAt: 100,
        confirmation: { status: 'loading', requestedAt: 5000 },
      });
      expect(answer(retry, 5001)).toBe(retry);
      expect(
        gameReducer(retry, event(correct, { type: 'AUDIO_ENDED', at: 5010 })),
      ).toBe(retry);
      retry = step(ready(retry, 5100), { type: 'AUDIO_STARTED', at: 5200 });
      retry = step(retry, { type: 'AUDIO_ENDED', at: 5500 });
      expect(step(retry, { type: 'ADVANCE_DUE', at: 5799 })).toBe(retry);
      const transition = step(retry, { type: 'ADVANCE_DUE', at: 5800 });
      expect(transition).toMatchObject({
        status: 'transitioning',
        acceptedAt: 100,
      });
      expect(step(transition, { type: 'ADVANCE_DUE', at: 5801 })).toBe(
        transition,
      );
      const continued = step(step(failed, { type: 'PAUSE' }), {
        type: 'CONTINUE',
        at: 6000,
      });
      expect(continued).toMatchObject({
        status: 'transitioning',
        acceptedAt: 100,
      });
    },
  );

  it('тайм-аут 15 секунд привязан к текущей загрузке, ресурсу и операции', () => {
    const initial = setup(1).state;
    const resource = prompt(initial);
    expect(
      step(initial, { type: 'RESOURCE_TIMEOUT', resource, at: 14999 }),
    ).toBe(initial);
    const failed = step(initial, {
      type: 'RESOURCE_TIMEOUT',
      resource,
      at: 15000,
    });
    expect(failed).toMatchObject({
      status: 'error',
      failure: { phase: 'preparation', resource, reason: 'timeout' },
    });
    const retry = step(failed, { type: 'RETRY', at: 20000 });
    expect(step(retry, { type: 'RESOURCE_TIMEOUT', resource, at: 34999 })).toBe(
      retry,
    );
    expect(
      gameReducer(
        retry,
        event(initial, { type: 'RESOURCE_TIMEOUT', resource, at: 35000 }),
      ),
    ).toBe(retry);
    expect(
      step(retry, { type: 'RESOURCE_TIMEOUT', resource, at: 35000 }).status,
    ).toBe('error');
  });

  it.each(['loading', 'starting'] as const)(
    'тайм-аут подтверждения %s сохраняет принятый ответ',
    (phase) => {
      let correct = answer(begin());
      if (phase === 'starting') correct = ready(correct, 110);
      const deadline = phase === 'loading' ? 15100 : 15110;
      expect(
        step(correct, {
          type: 'RESOURCE_TIMEOUT',
          resource: label(correct),
          at: deadline - 1,
        }),
      ).toBe(correct);
      expect(
        step(correct, {
          type: 'RESOURCE_TIMEOUT',
          resource: label(correct),
          at: deadline,
        }),
      ).toMatchObject({
        status: 'error',
        failure: { phase: 'confirmation', reason: 'timeout', acceptedAt: 100 },
      });
    },
  );

  it('отмена не является окончанием; декор и посторонние ресурсы не блокируют игру', () => {
    for (const state of [
      setup().state,
      begin(),
      answer(begin()),
      confirmed(),
    ]) {
      expect(step(state, { type: 'AUDIO_CANCELLED' })).toBe(state);
      expect(step(state, { type: 'DECOR_FAILED' })).toBe(state);
      const resource: Resource = { kind: 'image', path: 'decor.webp' };
      expect(
        step(state, { type: 'RESOURCE_FAILED', resource, reason: 'load' }),
      ).toBe(state);
      expect(step(state, { type: 'RESOURCE_READY', resource, at: 100 })).toBe(
        state,
      );
      expect(
        step(state, { type: 'RESOURCE_TIMEOUT', resource, at: 99999 }),
      ).toBe(state);
    }
  });
});

describe('устаревшие и недопустимые события', () => {
  it.each(['sessionId', 'roundId', 'operationId'] as const)(
    'не принимает события с устаревшим %s',
    (key) => {
      const state = begin();
      for (const body of [
        { type: 'ANSWER', itemId: state.round.correctOptionId, at: 100 },
        { type: 'REPEAT', at: 100 },
        { type: 'AUDIO_ENDED', at: 100 },
        { type: 'RESOURCE_FAILED', resource: prompt(state), reason: 'decode' },
        { type: 'EXIT' },
        { type: 'PAUSE' },
      ] satisfies GameEventData[]) {
        const stale = {
          ...event(state, body),
          [key]: key === 'sessionId' ? 'old-session' : -1,
        };
        expect(gameReducer(state, stale)).toBe(state);
      }
    },
  );

  it('недопустимые события оставляют тот же объект состояния', () => {
    const state = begin();
    for (const body of [
      { type: 'RETRY', at: 100 },
      { type: 'CONTINUE', at: 100 },
      { type: 'RETRY_DUE', at: 100 },
      { type: 'ADVANCE_DUE', at: 999999 },
      { type: 'AUDIO_STARTED', at: 100 },
      { type: 'RETURN' },
      { type: 'ACTIVITY' },
    ] satisfies GameEventData[])
      expect(step(state, body)).toBe(state);
  });
});

describe('контракт будущих адаптеров', () => {
  it('подготовка требует картинки и все учебные клипы; частичная готовность не запускает звук', () => {
    const initial = setup(1).state;
    const requirements = getGameRequirements(initial);
    expect(requirements.scope).toEqual({
      sessionId: 'session-1',
      roundId: 1,
      operationId: initial.operationId,
    });
    if (requirements.work.kind !== 'prepare') throw new Error('Нет подготовки');
    expect(requirements.work.resources).toHaveLength(5);
    expect(requirements.work.timeoutAt).toBe(15000);
    const resource = requirements.work.resources[0]!;
    const partial = step(initial, { type: 'RESOURCE_READY', resource, at: 10 });
    expect(getGameRequirements(partial)).toMatchObject({
      scope: requirements.scope,
      work: {
        kind: 'prepare',
        resources: requirements.work.resources.slice(1),
        timeoutAt: 15000,
      },
    });
    expect(step(partial, { type: 'RESOURCE_READY', resource, at: 11 })).toBe(
      partial,
    );
    expect(
      step(partial, { type: 'RESOURCE_FAILED', resource, reason: 'load' }),
    ).toBe(partial);
    const starting = ready(partial, 20);
    expect(getGameRequirements(starting)).toMatchObject({
      work: {
        kind: 'play',
        resource: prompt(initial),
        started: false,
        timeoutAt: 15020,
      },
    });
    const playing = step(starting, { type: 'AUDIO_STARTED', at: 30 });
    expect(getGameRequirements(playing)).toMatchObject({
      scope: getGameRequirements(starting).scope,
      work: { kind: 'play', started: true, timeoutAt: null },
    });
    expect(
      step(playing, {
        type: 'RESOURCE_TIMEOUT',
        resource: prompt(initial),
        at: 999999,
      }),
    ).toBe(playing);
    const ended = step(playing, { type: 'AUDIO_ENDED', at: 100 });
    expect(getGameRequirements(ended).work).toEqual({
      kind: 'wait',
      timer: { type: 'IDLE_DUE', at: 10100 },
    });
    expect(getGameRequirements(step(ended, { type: 'ACTIVITY' })).work).toEqual(
      { kind: 'wait', timer: null },
    );
  });

  it('правильный ответ заменяет задание загрузкой названия; переход ждёт обе границы', () => {
    const playing = begin();
    const correct = answer(playing);
    expect(getGameRequirements(correct)).toMatchObject({
      work: { kind: 'prepare', resources: [label(correct)], timeoutAt: 15100 },
    });
    expect(getGameRequirements(correct).scope).not.toEqual(
      getGameRequirements(playing).scope,
    );
    const starting = ready(correct, 110);
    expect(getGameRequirements(starting).work).toEqual({
      kind: 'play',
      resource: label(correct),
      sequence: [label(correct).path],
      started: false,
      introduction: 'correct',
      timeoutAt: 15110,
    });
    const confirming = step(starting, { type: 'AUDIO_STARTED', at: 120 });
    expect(getGameRequirements(confirming).work).toEqual({
      kind: 'play',
      resource: label(correct),
      sequence: [label(correct).path],
      started: true,
      introduction: 'correct',
      timeoutAt: null,
    });
    expect(
      step(confirming, {
        type: 'RESOURCE_TIMEOUT',
        resource: label(correct),
        at: 99999,
      }),
    ).toBe(confirming);
    const ended = step(confirming, { type: 'AUDIO_ENDED', at: 2000 });
    expect(getGameRequirements(ended).work).toEqual({
      kind: 'wait',
      timer: { type: 'ADVANCE_DUE', at: 2300 },
    });
    const transition = step(ended, { type: 'ADVANCE_DUE', at: 2300 });
    expect(getGameRequirements(transition).work).toEqual({
      kind: 'next-round',
      roundId: 2,
      optionCount: 2,
    });
  });

  it('ошибка ответа требует тишины 250 мс; пауза, ошибка ресурса и выход требуют остановки', () => {
    const waiting = begin();
    const wrong = answer(waiting, 100, false);
    expect(getGameRequirements(wrong).work).toEqual({
      kind: 'wait',
      timer: { type: 'RETRY_DUE', at: 350 },
    });
    const failure = step(waiting, {
      type: 'RESOURCE_FAILED',
      resource: prompt(waiting),
      reason: 'decode',
    });
    expect(failure).toMatchObject({
      status: 'error',
      failure: { phase: 'prompt' },
    });
    for (const state of [
      step(waiting, { type: 'PAUSE' }),
      step(waiting, { type: 'EXIT' }),
      failure,
    ]) {
      expect(getGameRequirements(state).work).toEqual({ kind: 'stop' });
      expect(getGameRequirements(state).scope).not.toEqual(
        getGameRequirements(waiting).scope,
      );
    }
  });

  it('повтор во время подготовки заменяет запросы; зависший запуск имеет срок', () => {
    const initial = setup().state;
    const repeated = step(initial, { type: 'REPEAT', at: 100 });
    expect(getGameRequirements(repeated)).toMatchObject({
      work: { kind: 'prepare', timeoutAt: 15100 },
    });
    expect(repeated.operationId).toBeGreaterThan(initial.operationId);
    const starting = ready(repeated, 110);
    expect(
      step(starting, {
        type: 'RESOURCE_TIMEOUT',
        resource: prompt(starting),
        at: 15109,
      }),
    ).toBe(starting);
    expect(
      step(starting, {
        type: 'RESOURCE_TIMEOUT',
        resource: prompt(starting),
        at: 15110,
      }),
    ).toMatchObject({
      status: 'error',
      failure: { phase: 'prompt', reason: 'timeout' },
    });
  });
});

describe('последовательности событий', () => {
  it.each([0, 1, 2])(
    'раздел %s: три полных цикла, ошибки, повторы, паузы и устаревшие результаты',
    (index) => {
      const { state: initial, generate } = setup(index);
      let state = initial;
      const accepted: number[] = [];
      const targets: string[] = [];
      let at = 0;
      for (
        let roundIndex = 0;
        roundIndex < categoryIds(categories[index]!).length * 3;
        roundIndex++
      ) {
        const round = state.round;
        targets.push(round.correctOptionId);
        state = begin(state, at + 20);
        state = answer(state, at + 100, false);
        state = step(state, { type: 'RETRY_DUE', at: at + 350 });
        const obsolete = state;
        state = step(state, { type: 'REPEAT', at: at + 400 });
        state = step(state, { type: 'PAUSE' });
        state = step(state, { type: 'CONTINUE', at: at + 500 });
        state = begin(state, at + 600);
        expect(state.round).toEqual(round);
        const action = event(state, {
          type: 'ANSWER',
          itemId: round.correctOptionId,
          at: at + 700,
        });
        state = gameReducer(state, action);
        expect(state.status).toBe('correct');
        accepted.push(round.id);
        expect(gameReducer(state, action)).toBe(state);
        state = step(ready(state, at + 710), {
          type: 'AUDIO_STARTED',
          at: at + 720,
        });
        state = step(state, { type: 'AUDIO_ENDED', at: at + 900 });
        state = step(state, { type: 'ADVANCE_DUE', at: at + 1900 });
        expect(state.status).toBe('transitioning');
        const nextRound = generate();
        const generated = event(state, {
          type: 'ROUND_GENERATED',
          round: nextRound,
          at: at + 1910,
        });
        state = gameReducer(state, generated);
        expect(gameReducer(state, generated)).toBe(state);
        expect(
          gameReducer(
            state,
            event(obsolete, { type: 'AUDIO_STARTED', at: at + 2000 }),
          ),
        ).toBe(state);
        expect(state).toMatchObject({
          status: 'preparing',
          mistakes: 0,
          reminderUsed: false,
          round: { id: round.id + 1 },
        });
        at += 3000;
      }
      expect(new Set(accepted).size).toBe(accepted.length);
      const ids = categoryIds(categories[index]!).sort();
      for (let cycle = 0; cycle < 3; cycle++)
        expect(
          targets.slice(cycle * ids.length, (cycle + 1) * ids.length).sort(),
        ).toEqual(ids);
      expect(step(state, { type: 'EXIT' }).status).toBe('ended');
    },
  );
});

describe('ошибка изображения на экране', () => {
  it('блокирует ответы после подготовки и сохраняет контекст принятого ответа', () => {
    const waiting = begin(setup(1).state);
    const item = waiting.round.options[0]!;
    if (item.kind !== 'animal') throw new Error('Ожидается животное');
    const failed = step(waiting, { type: 'IMAGE_FAILED', path: item.image });
    expect(failed.status).toBe('error');
    expect(answer(failed)).toBe(failed);
    expect(step(waiting, { type: 'IMAGE_FAILED', path: 'unknown' })).toBe(
      waiting,
    );
    const correct = answer(waiting);
    const failure = step(correct, { type: 'IMAGE_FAILED', path: item.image });
    expect(failure).toMatchObject({
      status: 'error',
      failure: {
        phase: 'confirmation',
        resource: { kind: 'image', path: item.image },
        acceptedAt: 100,
      },
    });
    const retry = step(failure, { type: 'RETRY', at: 200 });
    expect(getGameRequirements(retry).work).toMatchObject({
      kind: 'prepare',
      resources: [{ kind: 'image', path: item.image }],
    });
    const restored = step(retry, {
      type: 'RESOURCE_READY',
      resource: { kind: 'image', path: item.image },
      at: 210,
    });
    expect(restored).toMatchObject({ status: 'correct', acceptedAt: 100 });
    expect(getGameRequirements(restored).work).toMatchObject({
      kind: 'prepare',
      resources: [label(restored)],
    });
  });
});

it('ошибка картинки сохраняет паузу, принятый ответ и отсеивает старые операции', () => {
  const initial = setup(1).state;
  const waiting = begin(initial);
  const resource = getGameRequirements(initial).work;
  if (resource.kind !== 'prepare') throw new Error('Нет подготовки');
  const image = resource.resources.find(
    (resource) => resource.kind === 'image',
  )!;
  const failedEvent = event(waiting, {
    type: 'IMAGE_FAILED',
    path: image.path,
  });
  const repeated = step(waiting, { type: 'REPEAT', at: 30 });
  expect(gameReducer(repeated, failedEvent)).toBe(repeated);
  const paused = step(waiting, { type: 'PAUSE' });
  const failedPaused = step(paused, { type: 'IMAGE_FAILED', path: image.path });
  expect(failedPaused).toMatchObject({
    status: 'paused',
    resume: { status: 'error', failure: { phase: 'preparation' } },
  });
  const failure = step(waiting, { type: 'IMAGE_FAILED', path: image.path });
  expect(step(failure, { type: 'IMAGE_FAILED', path: image.path })).toBe(
    failure,
  );
  const correct = answer(waiting);
  const audioFailure = step(correct, {
    type: 'RESOURCE_FAILED',
    resource: label(correct),
    reason: 'decode',
  });
  const imageFailure = step(audioFailure, {
    type: 'IMAGE_FAILED',
    path: image.path,
  });
  expect(imageFailure).toMatchObject({
    status: 'error',
    failure: { phase: 'confirmation', acceptedAt: 100 },
  });
  const repairing = step(imageFailure, { type: 'RETRY', at: 200 });
  expect(
    step(repairing, {
      type: 'RESOURCE_READY',
      resource: label(correct),
      at: 201,
    }),
  ).toBe(repairing);
  expect(
    step(repairing, { type: 'RESOURCE_TIMEOUT', resource: image, at: 15200 }),
  ).toMatchObject({
    status: 'error',
    failure: { reason: 'timeout', phase: 'confirmation', acceptedAt: 100 },
  });
  const pauseAfter = step(repairing, { type: 'PAUSE' });
  expect(step(pauseAfter, { type: 'CONTINUE', at: 500 })).toMatchObject({
    status: 'transitioning',
    acceptedAt: 100,
  });
});

it('выбирает реплики входа, ошибки, подсказки, напоминания и продолжения; повтор оставляет только задание', () => {
  let state = setup().state;
  expect(getGameRequirements(ready(state)).work).toMatchObject({
    introduction: 'hello',
  });
  state = begin(state);
  expect(
    getGameRequirements(step(state, { type: 'REPEAT', at: 50 })).work,
  ).toMatchObject({ introduction: null });
  for (const [index, introduction] of [
    'think-again',
    'hint',
    'try-again',
    null,
  ].entries()) {
    state = answer(state, 100 + index * 1000, false);
    state = step(state, { type: 'RETRY_DUE', at: 350 + index * 1000 });
    expect(getGameRequirements(state).work).toMatchObject({ introduction });
    state = step(state, { type: 'AUDIO_STARTED', at: 400 + index * 1000 });
  }
  state = step(state, { type: 'AUDIO_ENDED', at: 4000 });
  const reminder = step(state, { type: 'IDLE_DUE', at: 14000 });
  expect(getGameRequirements(reminder).work).toMatchObject({
    introduction: 'listen',
  });
  const resumed = step(step(state, { type: 'PAUSE' }), {
    type: 'CONTINUE',
    at: 15000,
  });
  expect(getGameRequirements(ready(resumed)).work).toMatchObject({
    introduction: 'continue',
  });
});

it('похвала звучит через раунд с тремя вариантами, переходная реплика — каждое пятое задание', () => {
  const s = setup();
  let state = s.state;
  for (const [index, introduction] of [
    'correct',
    null,
    'well-done',
    null,
    'very-good',
    null,
    'correct',
  ].entries()) {
    if (index > 0)
      expect(getGameRequirements(ready(state)).work).toMatchObject({
        introduction: (index + 1) % 5 === 0 ? 'next-one' : null,
      });
    state = ready(answer(begin(state), index * 10000 + 100));
    expect(getGameRequirements(state).work).toMatchObject({ introduction });
    state = step(state, { type: 'AUDIO_STARTED', at: index * 10000 + 200 });
    state = step(state, { type: 'AUDIO_ENDED', at: index * 10000 + 500 });
    state = step(state, { type: 'ADVANCE_DUE', at: index * 10000 + 2000 });
    state = step(state, {
      type: 'ROUND_GENERATED',
      round: s.generate(state.adaptation.answerCount),
      at: index * 10000 + 2001,
    });
  }
});

describe('учёт адаптации в существующей сессии', () => {
  it('учитывает принятый ответ один раз, включая ошибку подтверждения и паузу', () => {
    const waiting = begin();
    const accepted = answer(waiting);
    expect(accepted.adaptation).toEqual({
      answerCount: 2,
      streak: { kind: 'clean', count: 1 },
    });
    expect(answer(accepted).adaptation).toBe(accepted.adaptation);
    const failed = step(accepted, {
      type: 'RESOURCE_FAILED',
      resource: label(accepted),
      reason: 'load',
    });
    expect(failed.status).toBe('error');
    expect(failed.adaptation).toBe(accepted.adaptation);
    const retry = step(failed, { type: 'RETRY', at: 200 });
    expect(retry.adaptation).toBe(accepted.adaptation);
    const paused = step(retry, { type: 'PAUSE' });
    const continued = step(paused, { type: 'CONTINUE', at: 300 });
    expect(continued.status).toBe('transitioning');
    expect(continued.adaptation).toBe(accepted.adaptation);
    expect(
      gameReducer(
        continued,
        event(waiting, {
          type: 'ANSWER',
          itemId: waiting.round.correctOptionId,
          at: 301,
        }),
      ),
    ).toBe(continued);
  });
  it('несколько ошибок внутри раунда становятся одним результатом, повторы и паузы не влияют', () => {
    let state = begin();
    const initial = state.adaptation;
    for (let i = 0; i < 3; i++) {
      const at = 100 + i * 1000;
      state = answer(state, at, false);
      expect(state.adaptation).toBe(initial);
      state = step(state, { type: 'RETRY_DUE', at: at + 250 });
      state = step(state, { type: 'AUDIO_STARTED', at: at + 260 });
    }
    state = step(state, { type: 'REPEAT', at: 3300 });
    state = step(state, { type: 'PAUSE' });
    state = step(state, { type: 'CONTINUE', at: 3400 });
    state = begin(state, 3500);
    expect(state.adaptation).toBe(initial);
    state = answer(state, 3600);
    expect(state.adaptation).toEqual({
      answerCount: 2,
      streak: { kind: 'mistake', count: 1 },
    });
    expect(setup().state.adaptation).toEqual({ answerCount: 2, streak: null });
  });
  it('передаёт новое количество только подготовке следующего раунда', () => {
    const prepared = setup();
    let state = prepared.state;
    for (let i = 0; i < 5; i++) {
      const at = i * 5000 + 100;
      state = begin(state, at);
      const round = state.round;
      state = answer(state, at + 100);
      expect(state.round).toBe(round);
      state = ready(state, at + 110);
      state = step(state, { type: 'AUDIO_STARTED', at: at + 120 });
      state = step(state, { type: 'AUDIO_ENDED', at: at + 200 });
      state = step(state, { type: 'ADVANCE_DUE', at: at + 1300 });
      expect(getGameRequirements(state).work).toMatchObject({
        kind: 'next-round',
        optionCount: i === 4 ? 3 : 2,
      });
      if (i < 4)
        state = step(state, {
          type: 'ROUND_GENERATED',
          round: prepared.generate(state.adaptation.answerCount),
          at: at + 1400,
        });
    }
    expect(state.adaptation).toEqual({ answerCount: 3, streak: null });
  });
});
