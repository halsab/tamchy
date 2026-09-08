// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contentV2 as content } from '../../content/v2/catalog.ts';
import strings from '../../content/tt.json';
import type { CategoryId } from '../../content/types.ts';
import {
  audioClipIds,
  exerciseDefinitions,
} from '../../domain/game/exercise.ts';
import type { ExerciseKind } from '../../domain/game/exercise.ts';
import { allowedSeniorKinds } from '../../domain/game/senior-planner.ts';
import { roundResources } from '../../domain/game/resources.ts';
import {
  browserAudio,
  browserImages,
  deferred,
  flush,
  identifyInteractions,
  mockCanvas,
  successfulFetch,
} from '../../../tests/helpers/browser.ts';
import { GameScreen } from './GameScreen.tsx';
import { useGameSession } from './use-game-session.ts';
import type { GameSessionController } from './use-game-session.ts';

beforeEach(() => {
  vi.useFakeTimers();
  mockCanvas();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(categoryId: CategoryId) {
  const category = content.categories.find((x) => x.id === categoryId)!;
  const audio = browserAudio(true),
    images = browserImages(),
    fetch = successfulFetch();
  const pixels = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([128, 128, 128, 255]),
  };
  const processor = { run: vi.fn(async () => pixels), dispose: vi.fn() };
  const queue: number[] = [];
  let seed = 18,
    game!: GameSessionController;
  const options = {
    audio: { ...audio, fetch: identifyInteractions(fetch) },
    images: { ...images, fetch },
    tintedImages: { processor, fetch },
    random: () =>
      queue.shift() ??
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
  };
  function Harness() {
    const current = useGameSession(options);
    useLayoutEffect(() => {
      game = current;
    });
    return (
      <GameScreen
        category={category}
        game={current}
        onHome={() => current.exit(true)}
      />
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const settle = () => act(flush);
  const tick = async (ms: number) => {
    await act(() => vi.advanceTimersByTimeAsync(ms));
    await settle();
  };
  function steer(kind: ExerciseKind, first = false) {
    const state = game.state;
    const count =
      !first && state && 'correctCount' in state.adaptation
        ? state.adaptation.correctCount
        : 0;
    const allowed = allowedSeniorKinds(
      categoryId,
      count,
      first ? [] : (state?.recentKinds ?? []),
    );
    const levels = [1, 2, 3].filter((level) =>
      allowed.some((x) => x.difficulty === level),
    );
    const difficulty = exerciseDefinitions[kind].difficulty;
    const weights = [0, 40, 35, 25];
    const total = levels.reduce((sum, level) => sum + weights[level]!, 0);
    const before = levels
      .filter((x) => x < difficulty)
      .reduce((sum, level) => sum + weights[level]!, 0);
    const pool = allowed.filter((x) => x.difficulty === difficulty);
    expect(pool.some((x) => x.kind === kind)).toBe(true);
    queue.push(
      (before + weights[difficulty]! / 2) / total,
      (pool.findIndex((x) => x.kind === kind) + 0.5) / pool.length,
    );
  }
  async function click(name: string) {
    act(() => screen.getByRole('button', { name }).click());
    await settle();
  }
  async function finishSpeech() {
    for (let i = 0; i < 8; i++) {
      const source = audio.sources.at(-1);
      if (!source?.onended) break;
      act(() => source.onended?.());
      await settle();
    }
  }
  async function solve(next?: ExerciseKind) {
    const state = game.state!;
    await click(
      state.round.options.find((x) => x.id === state.round.correctOptionId)!
        .labelTt,
    );
    expect(game.state?.status).toBe('correct');
    await finishSpeech();
    if (next) steer(next);
    await tick(1200);
    expect(game.state?.status).toBe('awaiting');
  }
  return {
    audio,
    fetch,
    processor,
    settle,
    tick,
    steer,
    click,
    finishSpeech,
    solve,
    get game() {
      return game;
    },
    async start(kind: ExerciseKind) {
      steer(kind, true);
      act(() => game.start(category, true, 'senior'));
      await settle();
    },
  };
}

it('старший экран начинает с четырёх ответов после подготовки всех ресурсов и фактического старта задания', async () => {
  const s = setup('colors');
  const pending =
    deferred<
      ReturnType<typeof s.processor.run> extends Promise<infer T> ? T : never
    >();
  s.processor.run.mockReturnValueOnce(pending.promise);
  await s.start('C2');
  expect(s.game.state?.status).toBe('preparing');
  const answers = within(
    screen.getByRole('group', { name: strings.game.answers }),
  ).getAllByRole('button');
  expect(answers).toHaveLength(4);
  expect(answers.every((x) => x.hasAttribute('disabled'))).toBe(true);
  expect(s.audio.learningSources).toHaveLength(0);
  pending.resolve({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([128, 128, 128, 255]),
  });
  await s.settle();
  expect(s.game.state?.status).toBe('awaiting');
  expect(answers.every((x) => !x.hasAttribute('disabled'))).toBe(true);
});

for (const categoryId of ['colors', 'animals', 'numbers'] as const)
  it(`${categoryId}: все виды проходят ошибку, подсказку, повтор, паузу, правильный ответ и один переход`, async () => {
    const s = setup(categoryId);
    const first =
      categoryId === 'colors' ? 'C1' : categoryId === 'animals' ? 'A1' : 'N1-A';
    await s.start(first);
    for (let i = 0; i < 8; i++) await s.solve();
    const kinds = (Object.keys(exerciseDefinitions) as ExerciseKind[]).filter(
      (kind) => exerciseDefinitions[kind].categoryId === categoryId,
    );
    for (const kind of kinds) {
      if (s.game.state!.recentKinds.every((x) => x === kind)) await s.solve();
      await s.solve(kind);
      const state = s.game.state!;
      expect(state.round.kind).toBe(kind);
      const options = state.round.options.map((x) => x.id);
      const wrong = state.round.options.find(
        (x) => x.id !== state.round.correctOptionId,
      )!;
      const correct = state.round.options.find(
        (x) => x.id === state.round.correctOptionId,
      )!;
      for (let i = 0; i < 2; i++) {
        await s.click(wrong.labelTt);
        expect(s.game.state?.status).toBe('retrying');
        await s.tick(250);
      }
      expect(
        screen.getByRole('button', { name: correct.labelTt }),
      ).toHaveAccessibleDescription(strings.game.hint);
      const old = s.audio.sources.at(-1)!;
      await s.click(strings.action.listenAgain);
      expect(old.stop).toHaveBeenCalled();
      expect(s.game.state?.round.options.map((x) => x.id)).toEqual(options);
      act(() => s.audio.changeState('interrupted'));
      expect(
        screen.getByRole('button', { name: strings.action.continue }),
      ).toBeVisible();
      await s.click(strings.action.continue);
      expect(s.game.state?.round.options.map((x) => x.id)).toEqual(options);
      await s.click(correct.labelTt);
      expect(
        screen.getByRole('img', { name: strings.game.correct }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: strings.action.listenAgain }),
      ).toBeDisabled();
      await s.finishSpeech();
      await s.tick(1199);
      expect(s.game.state?.round.id).toBe(state.round.id);
      await s.tick(1);
      expect(s.game.state?.round.id).toBe(state.round.id + 1);
      expect(s.game.state?.status).toBe('awaiting');
      expect(
        audioClipIds(state.round.confirmation).every((id) =>
          content.audio.some((x) => x.id === id),
        ),
      ).toBe(true);
    }
    await s.click(strings.nav.home);
    expect(s.game.state?.status).toBe('ended');
  });

it('сбой оттенка C3 восстанавливает именно повреждённый ресурс и сохраняет принятый ответ', async () => {
  const s = setup('colors');
  await s.start('C1');
  for (let i = 0; i < 3; i++) await s.solve();
  await s.solve('C3-A');
  const state = s.game.state!;
  const resources = roundResources(state.session, state.round).filter(
    (x) => x.kind === 'tinted-image',
  );
  const resource = resources.find((x, i) =>
    resources.slice(0, i).some((y) => y.path === x.path && y.hex !== x.hex),
  )!;
  expect(resource).toBeTruthy();
  await s.click(
    state.round.options.find((x) => x.id === state.round.correctOptionId)!
      .labelTt,
  );
  act(() => s.game.imageFailed(resource.path, resource.hex));
  expect(s.game.state?.status).toBe('error');
  if (s.game.state?.status !== 'error') throw Error();
  expect(s.game.state.failure.resource).toEqual(resource);
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  await s.click(strings.action.retry);
  expect(s.game.state?.round).toEqual(state.round);
  expect(s.game.state?.status).toBe('correct');
  await s.finishSpeech();
  await s.tick(1200);
  expect(s.game.state?.round.id).toBe(state.round.id + 1);
});

it('обязательный PNG не запускает звук при ошибке или тайм-ауте; повтор явный, домик доступен', async () => {
  const s = setup('colors');
  const pending = deferred<Awaited<ReturnType<typeof s.processor.run>>>();
  s.processor.run.mockReturnValueOnce(pending.promise);
  await s.start('C2');
  await s.tick(15000);
  expect(s.game.state?.status).toBe('error');
  expect(s.audio.learningSources).toHaveLength(0);
  expect(screen.getByRole('button', { name: strings.nav.home })).toBeEnabled();
  const round = s.game.state!.round;
  const calls = s.processor.run.mock.calls.length;
  await s.tick(30000);
  expect(s.processor.run).toHaveBeenCalledTimes(calls);
  await s.click(strings.action.retry);
  expect(s.game.state?.status).toBe('awaiting');
  expect(s.game.state?.round).toEqual(round);
  pending.resolve({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  await s.settle();
  expect(s.game.state?.round).toEqual(round);
});

it('пауза после старшего ответа сохраняет один зачёт и один переход, отменённая фраза не продолжается', async () => {
  const s = setup('numbers');
  await s.start('N1-C');
  const first = s.game.state!;
  await s.click(
    first.round.options.find((x) => x.id === first.round.correctOptionId)!
      .labelTt,
  );
  const lateEnd = s.audio.sources.at(-1)!.onended!;
  const accepted = s.game.state!.adaptation;
  act(() => s.audio.changeState('interrupted'));
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  act(lateEnd);
  await s.settle();
  const recordings = s.audio.sources.length;
  await s.tick(2000);
  expect(s.audio.sources).toHaveLength(recordings);
  await s.click(strings.action.continue);
  expect(s.game.state?.round.id).toBe(2);
  expect(s.game.state?.adaptation).toEqual(accepted);
  act(lateEnd);
  await s.settle();
  expect(s.game.state?.round.id).toBe(2);
});
