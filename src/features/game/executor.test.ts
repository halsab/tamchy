import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameCategories } from '../../../tests/helpers/game-content.ts';
import { createTintedImageService } from '../../services/assets/tinted-images.ts';
import type { GameEvent, GameEventData } from '../../domain/game/models.ts';
import { createGame, gameReducer, hasHint } from '../../domain/game/reducer.ts';
import { getGameRequirements } from '../../domain/game/requirements.ts';
import { createAudioService } from '../../services/audio/audio.ts';
import { createImageService } from '../../services/assets/images.ts';
import {
  browserAudio,
  browserImages,
  deferred,
  flush,
  successfulFetch,
  identifyInteractions,
} from '../../../tests/helpers/browser.ts';
import { createGameExecutor, type GameClock } from './executor.ts';
import { createSessionRounds } from './session-rounds.ts';

export function setup(categoryIndex = 0, clock?: GameClock) {
  const category = gameCategories[categoryIndex]!;
  const audioBoundary = browserAudio(true);
  const imageBoundary = browserImages();
  const fetch = successfulFetch();
  const audio = createAudioService({
    ...audioBoundary,
    fetch: identifyInteractions(fetch),
  });
  const images = createImageService({ ...imageBoundary, fetch });
  const processor = {
    run: vi.fn(async () => ({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    })),
    dispose: vi.fn(),
  };
  const tintedImages = createTintedImageService({ fetch, processor });
  const rounds = createSessionRounds('session', category, () => 0);
  const time: GameClock = clock ?? {
    now: () => performance.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id),
  };
  let state = createGame('session', category, rounds.get(1), time.now());
  const events: GameEvent[] = [];
  let autoReconcile = true;
  const dependencies = {
    audio,
    images,
    tintedImages,
    rounds,
    clock: time,
    send: (event: GameEvent) => {
      events.push(event);
      state = gameReducer(state, event);
      if (autoReconcile) executor.reconcile(getGameRequirements(state));
    },
  };
  let executor = createGameExecutor(dependencies);
  function event(data: GameEventData) {
    dependencies.send({ ...getGameRequirements(state).scope, ...data });
  }
  return {
    ...audioBoundary,
    ...imageBoundary,
    audio,
    processor,
    tintedImages,
    fetch,
    events,
    rounds,
    time,
    get state() {
      return state;
    },
    get executor() {
      return executor;
    },
    event,
    async endPrompt() {
      const work = getGameRequirements(state).work;
      if (work.kind !== 'play') throw new Error('Нет задания');
      for (let part = 0; part < work.sequence.length; part++) {
        audioBoundary.learningSources.at(-1)!.onended!();
        await flush();
      }
    },
    async start() {
      void audio.activate();
      executor.reconcile(getGameRequirements(state));
      await flush();
    },
    reconcile() {
      executor.reconcile(getGameRequirements(state));
    },
    delivery(enabled: boolean) {
      autoReconcile = enabled;
    },
    restart() {
      executor.dispose();
      executor = createGameExecutor(dependencies);
    },
    dispose() {
      executor.dispose();
      audio.dispose();
      images.dispose();
      tintedImages.dispose();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('общий клип задания и подтверждения загружается один раз до разрешения ответа', async () => {
  const s = setup();
  await s.start();
  expect(s.state.status).toBe('awaiting');
  const paths = s.fetch.mock.calls.map(([path]) => String(path));
  expect(
    paths.filter((path) => path.endsWith('color-orange.mp3')),
  ).toHaveLength(1);
  expect(
    s.events.filter(
      (event) =>
        event.type === 'RESOURCE_READY' &&
        event.resource.path.endsWith('color-orange.mp3'),
    ),
  ).toHaveLength(2);
  s.dispose();
});

it('счётное упражнение ждёт готовые пиксели; выход отсекает поздний worker', async () => {
  const s = setup(2);
  const pending = deferred<Awaited<ReturnType<typeof s.processor.run>>>();
  s.processor.run.mockReturnValueOnce(pending.promise);
  await s.start();
  expect(s.processor.run).toHaveBeenCalledOnce();
  expect(s.state.status).toBe('preparing');
  s.event({ type: 'ANSWER', itemId: s.state.round.correctOptionId, at: 0 });
  expect(s.state.status).toBe('preparing');
  s.event({ type: 'EXIT' });
  pending.resolve({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  await flush();
  expect(s.state.status).toBe('ended');
  expect(s.sources).toHaveLength(0);
  expect(s.tintedImages.cacheBytes()).toBe(0);
  s.dispose();
});

it('ошибка worker сохраняет упражнение и восстанавливается явным повтором', async () => {
  const s = setup(2);
  s.processor.run.mockRejectedValueOnce(new Error('decode'));
  await s.start();
  const exercise = s.state.round;
  expect(s.state).toMatchObject({
    status: 'error',
    failure: { phase: 'preparation', resource: { kind: 'tinted-image' } },
  });
  s.event({ type: 'RETRY', at: 1 });
  await flush();
  expect(s.state.status).toBe('awaiting');
  expect(s.state.round).toBe(exercise);
  s.dispose();
});

it('сбой второй части блокирует ответы и повторяет полную фразу без смены вариантов', async () => {
  const s = setup();
  await s.start();
  const work = getGameRequirements(s.state).work;
  if (work.kind !== 'play') throw new Error('Нет фразы');
  const exercise = s.state.round;
  const makeSource = s.context.createBufferSource.getMockImplementation()!;
  s.context.createBufferSource.mockImplementationOnce(() => {
    const source = makeSource();
    source.start.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    return source;
  });
  s.learningSources.at(-1)!.onended!();
  await flush();
  expect(s.state).toMatchObject({
    status: 'error',
    failure: { phase: 'prompt', resource: { path: work.sequence[1] } },
  });
  s.event({ type: 'ANSWER', itemId: exercise.correctOptionId, at: 1 });
  expect(s.state.status).toBe('error');
  s.event({ type: 'RETRY', at: 2 });
  await flush();
  expect(s.state.status).toBe('awaiting');
  expect(s.state.round).toBe(exercise);
  expect(s.state.adaptation.streak).toBeNull();
  await s.endPrompt();
  expect(s.events.filter((event) => event.type === 'AUDIO_ENDED')).toHaveLength(
    1,
  );
  s.dispose();
});

describe('исполнитель требований с настоящим доменом', () => {
  it('готовит независимые ресурсы параллельно без перезапуска частичного успеха', async () => {
    const s = setup(1);
    const network = deferred<Response>();
    s.fetch.mockImplementation((url) =>
      String(url).endsWith('.mp3')
        ? network.promise.then((response) => response.clone())
        : Promise.resolve(new Response('image')),
    );
    await s.start();
    expect(s.fetch).toHaveBeenCalledTimes(5);
    expect(s.events.filter((e) => e.type === 'RESOURCE_READY')).toHaveLength(2);
    s.reconcile();
    s.reconcile();
    expect(s.fetch).toHaveBeenCalledTimes(5);
    network.resolve(new Response('audio'));
    await flush();
    expect(s.state.status).toBe('awaiting');
    expect(s.learningSources).toHaveLength(1);
    s.reconcile();
    expect(s.learningSources[0]!.stop).not.toHaveBeenCalled();
    await s.endPrompt();
    expect(s.state).toMatchObject({
      status: 'awaiting',
      prompt: { status: 'ended' },
    });
    s.dispose();
  });

  it('общая подготовка истекает в 15000, частичная готовность не продлевает срок', async () => {
    const s = setup(1);
    const network = deferred<Response>();
    const image = deferred<Response>();
    s.fetch.mockReturnValue(network.promise).mockReturnValueOnce(image.promise);
    await s.start();
    await vi.advanceTimersByTimeAsync(14000);
    image.resolve(new Response('image'));
    await flush();
    expect(s.state.status).toBe('preparing');
    await vi.advanceTimersByTimeAsync(999);
    expect(s.state.status).toBe('preparing');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state).toMatchObject({
      status: 'error',
      failure: { reason: 'timeout' },
    });
    expect(
      s.fetch.mock.calls.slice(1).every(([, init]) => init?.signal?.aborted),
    ).toBe(true);
    network.resolve(new Response('late'));
    await flush();
    expect(s.sources).toHaveLength(0);
    s.dispose();
  });

  it('зависший resume ограничен сроком старта, выход немедленный', async () => {
    const s = setup();
    const resume = deferred<void>();
    s.context.resume.mockReturnValueOnce(resume.promise);
    await s.start();
    expect(s.state).toMatchObject({ status: 'preparing', stage: 'prompt' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(s.state).toMatchObject({
      status: 'error',
      failure: { reason: 'timeout', phase: 'prompt' },
    });
    s.event({ type: 'EXIT' });
    s.context.state = 'running';
    resume.resolve();
    await flush();
    expect(s.state.status).toBe('ended');
    expect(s.sources).toHaveLength(0);
    s.dispose();
  });

  it('правильный ответ сохраняет подтверждение после старта и даёт один следующий раунд', async () => {
    const s = setup();
    await s.start();
    const oldEnd = s.learningSources[0]!.onended!;
    s.event({
      type: 'ANSWER',
      itemId: s.state.round.correctOptionId,
      at: s.time.now(),
    });
    s.event({
      type: 'ANSWER',
      itemId: s.state.round.correctOptionId,
      at: s.time.now(),
    });
    await flush();
    expect(s.state).toMatchObject({
      status: 'correct',
      confirmation: { status: 'playing' },
    });
    expect(s.learningSources[0]!.stop).toHaveBeenCalledTimes(1);
    oldEnd();
    s.reconcile();
    expect(s.learningSources[1]!.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    s.learningSources[1]!.onended!();
    await vi.advanceTimersByTimeAsync(299);
    expect(s.state.round.id).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(s.state.round.id).toBe(2);
    expect(s.state.status).toBe('awaiting');
    expect(s.events.filter((e) => e.type === 'ROUND_GENERATED')).toHaveLength(
      1,
    );
    s.dispose();
  });

  it('две ошибки повторяют то же задание с подсказкой; повтор не накладывает записи', async () => {
    const s = setup(2);
    await s.start();
    const round = s.state.round;
    const wrong = round.options
      .map((x) => x.id)
      .find((id) => id !== round.correctOptionId)!;
    for (let i = 0; i < 2; i++) {
      s.event({ type: 'ANSWER', itemId: wrong, at: s.time.now() });
      await vi.advanceTimersByTimeAsync(249);
      expect(s.state.status).toBe('retrying');
      await vi.advanceTimersByTimeAsync(1);
      expect(s.state.status).toBe('awaiting');
    }
    expect(s.state.round).toEqual(round);
    expect(hasHint(s.state)).toBe(true);
    s.event({ type: 'REPEAT', at: s.time.now() });
    await flush();
    expect(s.learningSources).toHaveLength(4);
    expect(
      s.fetch.mock.calls.filter(
        ([path]) => !String(path).includes('/interaction/'),
      ),
    ).toHaveLength(4);
    expect(
      s.fetch.mock.calls.filter(([path]) =>
        String(path).includes('/interaction/'),
      ),
    ).toHaveLength(3);
    expect(s.state.round).toEqual(round);
    s.dispose();
  });

  it('ACTIVITY снимает напоминание; поздний таймер после отмены игнорируется', async () => {
    let now = 0;
    const callbacks: (() => void)[] = [];
    const clock: GameClock = {
      now: () => now,
      setTimeout: (cb) => {
        callbacks.push(cb);
        return callbacks.length;
      },
      clearTimeout: vi.fn(),
    };
    const s = setup(0, clock);
    await s.start();
    await s.endPrompt();
    const idle = callbacks.at(-1)!;
    s.event({ type: 'ACTIVITY' });
    now = 10000;
    idle();
    expect(s.state).toMatchObject({
      status: 'awaiting',
      prompt: { idleAt: null },
    });
    expect(s.events.some((e) => e.type === 'IDLE_DUE')).toBe(false);
    s.dispose();
  });

  it('ранний таймер назначается снова; callback передаёт фактическое время', async () => {
    let now = 0;
    const callbacks: (() => void)[] = [];
    const clock: GameClock = {
      now: () => now,
      setTimeout: (cb) => {
        callbacks.push(cb);
        return callbacks.length;
      },
      clearTimeout: vi.fn(),
    };
    const s = setup(0, clock);
    await s.start();
    await s.endPrompt();
    now = 9999;
    callbacks.at(-1)!();
    expect(s.events.some((e) => e.type === 'IDLE_DUE')).toBe(false);
    now = 10123;
    callbacks.at(-1)!();
    expect(s.events.at(-1)).toMatchObject({ type: 'IDLE_DUE', at: 10123 });
    s.dispose();
  });

  it('cleanup/setup с тем же токеном отсеивает старую загрузку', async () => {
    const s = setup();
    const network = deferred<Response>();
    s.fetch.mockReturnValueOnce(network.promise);
    await s.start();
    s.restart();
    s.reconcile();
    await flush();
    expect(s.state.status).toBe('awaiting');
    const count = s.events.length;
    network.resolve(new Response('late'));
    await flush();
    expect(s.events).toHaveLength(count);
    expect(s.learningSources).toHaveLength(1);
    s.dispose();
  });

  it('следующий раунд сохраняется до принятия через повтор, cleanup и паузу', async () => {
    const s = setup();
    await s.start();
    s.event({
      type: 'ANSWER',
      itemId: s.state.round.correctOptionId,
      at: s.time.now(),
    });
    await flush();
    s.event({ type: 'PAUSE' });
    s.delivery(false);
    s.event({ type: 'CONTINUE', at: s.time.now() });
    s.reconcile();
    s.reconcile();
    const prepared = s.rounds.get(2);
    s.restart();
    s.event({ type: 'PAUSE' });
    s.event({ type: 'RETURN' });
    s.event({ type: 'CONTINUE', at: s.time.now() });
    s.delivery(true);
    s.reconcile();
    await flush();
    expect(s.state.round).toEqual(prepared);
    expect(s.state.round.id).toBe(2);
    s.dispose();
  });

  it('ошибка подтверждения и RETRY сохраняют принятый ответ', async () => {
    const s = setup();
    await s.start();
    const makeSource = s.context.createBufferSource.getMockImplementation()!;
    s.context.createBufferSource
      .mockImplementationOnce(makeSource)
      .mockImplementationOnce(() => {
        const source = makeSource();
        source.start.mockImplementationOnce(() => {
          throw new Error('playback');
        });
        return source;
      });
    s.event({
      type: 'ANSWER',
      itemId: s.state.round.correctOptionId,
      at: s.time.now(),
    });
    await flush();
    expect(s.state).toMatchObject({
      status: 'error',
      failure: { phase: 'confirmation', acceptedAt: 0 },
    });
    s.event({ type: 'RETRY', at: s.time.now() });
    await flush();
    expect(s.state).toMatchObject({ status: 'correct', acceptedAt: 0 });
    s.learningSources.at(-1)!.onended!();
    await vi.advanceTimersByTimeAsync(1200);
    expect(s.state.round.id).toBe(2);
    expect(s.events.filter((e) => e.type === 'ROUND_GENERATED')).toHaveLength(
      1,
    );
    s.dispose();
  });
});

it('поздняя готовность не обходит дедлайн, если callback таймера ещё не доставлен', async () => {
  let now = 0;
  const clock: GameClock = {
    now: () => now,
    setTimeout: () => 1,
    clearTimeout: vi.fn(),
  };
  const s = setup(0, clock);
  const network = deferred<Response>();
  s.fetch.mockReturnValueOnce(network.promise);
  await s.start();
  now = 15001;
  network.resolve(new Response('late'));
  await flush();
  expect(s.state).toMatchObject({
    status: 'error',
    failure: { reason: 'timeout' },
  });
  expect(s.sources).toHaveLength(0);
  s.dispose();
});

it('поздний resume не обходит срок запуска при задержке callback таймера', async () => {
  let now = 0;
  const clock: GameClock = {
    now: () => now,
    setTimeout: () => 1,
    clearTimeout: vi.fn(),
  };
  const s = setup(0, clock);
  const resume = deferred<void>();
  s.context.resume.mockReturnValueOnce(resume.promise);
  await s.start();
  now = 15001;
  s.context.state = 'running';
  resume.resolve();
  await flush();
  expect(s.state).toMatchObject({
    status: 'error',
    failure: { reason: 'timeout' },
  });
  expect(s.events.some((event) => event.type === 'AUDIO_STARTED')).toBe(false);
  expect(s.sources.every((source) => source.onended === null)).toBe(true);
  s.dispose();
});

it('cleanup/setup звучавшей операции запрашивает паузу без второго source', async () => {
  const s = setup();
  await s.start();
  const oldEnd = s.learningSources[0]!.onended!;
  s.restart();
  s.reconcile();
  await flush();
  expect(s.state.status).toBe('paused');
  oldEnd();
  expect(s.state.status).toBe('paused');
  expect(s.learningSources).toHaveLength(1);
  s.dispose();
});

it('старые callbacks таймера не действуют после нового исполнителя с тем же scope', async () => {
  let now = 0;
  const callbacks: (() => void)[] = [];
  const clock: GameClock = {
    now: () => now,
    setTimeout: (cb) => {
      callbacks.push(cb);
      return callbacks.length;
    },
    clearTimeout: vi.fn(),
  };
  const s = setup(0, clock);
  await s.start();
  await s.endPrompt();
  const oldTimer = callbacks.at(-1)!;
  s.restart();
  s.reconcile();
  now = 10000;
  oldTimer();
  expect(s.events.some((e) => e.type === 'IDLE_DUE')).toBe(false);
  callbacks.at(-1)!();
  await flush();
  expect(s.events.filter((e) => e.type === 'IDLE_DUE')).toHaveLength(1);
  s.dispose();
  s.reconcile();
  expect(s.learningSources.at(-1)!.onended).toBeNull();
});
