import { expect, type Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 as content } from '../../src/content/v2/catalog.ts';
import type { CategoryId } from '../../src/content/types.ts';
import {
  exerciseDefinitions,
  type ExerciseKind,
} from '../../src/domain/game/exercise.ts';
import { createSeniorExerciseGenerator } from '../../src/domain/game/senior-exercises.ts';
import { allowedSeniorKinds } from '../../src/domain/game/senior-planner.ts';
import {
  initialSeniorAdaptation,
  recordSeniorResult,
} from '../../src/domain/game/senior-adaptation.ts';
import { answerButtons } from './fixtures.ts';

type RandomWindow = Window & {
  seniorRandom?: { enabled: boolean; seed: number; queued: number[] };
};

export async function installSeniorRandom(page: Page) {
  await page.addInitScript(() => {
    const original = Math.random;
    // Синхронизация с ожидаемым генератором включается только перед входом в раздел.
    const state = { enabled: false, seed: 17, queued: [] as number[] };
    (window as RandomWindow).seniorRandom = state;
    Math.random = () =>
      state.enabled
        ? (state.queued.shift() ??
          (state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0) /
            2 ** 32)
        : original();
  });
}

export async function visibility(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

export async function startSeniorPlayer(page: Page, categoryId: CategoryId) {
  let seed = 17;
  const queued: number[] = [];
  const random = () =>
    queued.shift() ??
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const generator = createSeniorExerciseGenerator(content, categoryId, random);
  let adaptation = initialSeniorAdaptation();
  let recentKinds: ExerciseKind[] = [];
  let exercise = generator.get({
    roundId: 1,
    optionCount: 4,
    correctCount: 0,
    recentKinds,
  });
  generator.accept(1);
  await page.evaluate(() => {
    Object.assign((window as RandomWindow).seniorRandom!, {
      enabled: true,
      seed: 17,
      queued: [],
    });
  });
  await page
    .getByRole('button', {
      name: content.categories.find((x) => x.id === categoryId)!.labelTt,
      exact: true,
    })
    .click();
  async function ready() {
    await expect(
      page.getByText(exercise.prompt.textTt, { exact: true }),
    ).toBeVisible();
    await expect(answerButtons(page)).toHaveCount(exercise.options.length);
    await expect
      .poll(() =>
        answerButtons(page).evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        ),
      )
      .toEqual(exercise.options.map((x) => x.labelTt));
    for (const button of await answerButtons(page).all())
      await expect(button).toBeEnabled({ timeout: 18000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator('main img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
  }
  const correct = () =>
    page.getByRole('button', {
      name: exercise.options.find((x) => x.id === exercise.correctOptionId)!
        .labelTt,
      exact: true,
    });
  async function advance(
    mistakes = false,
    nextKind?: ExerciseKind,
    pauseAfter = false,
  ) {
    const old = exercise;
    adaptation = recordSeniorResult(adaptation, mistakes, old.kind);
    recentKinds = [...recentKinds, old.kind].slice(-2);
    if (nextKind) {
      // Первые два значения выбирают разрешённые уровень и вид; остальные перемешивания остаются случайными.
      const allowed = allowedSeniorKinds(
        categoryId,
        adaptation.correctCount,
        recentKinds,
      );
      const difficulty = exerciseDefinitions[nextKind].difficulty;
      const weights = [0, 40, 35, 25];
      const levels = [1, 2, 3].filter((level) =>
        allowed.some((x) => x.difficulty === level),
      );
      const pool = allowed.filter((x) => x.difficulty === difficulty);
      expect(pool.some((x) => x.kind === nextKind)).toBe(true);
      const total = levels.reduce((sum, level) => sum + weights[level]!, 0);
      const before = levels
        .filter((level) => level < difficulty)
        .reduce((sum, level) => sum + weights[level]!, 0);
      const draws = [
        (before + weights[difficulty]! / 2) / total,
        (pool.findIndex((x) => x.kind === nextKind) + 0.5) / pool.length,
      ];
      queued.push(...draws);
      await page.evaluate(
        (draws) => (window as RandomWindow).seniorRandom!.queued.push(...draws),
        draws,
      );
    }
    const next = generator.get({
      roundId: old.id + 1,
      optionCount: adaptation.answerCount,
      correctCount: adaptation.correctCount,
      recentKinds,
    });
    generator.accept(next.id);
    const firstButton = await answerButtons(page).first().elementHandle();
    await correct().dblclick({ delay: 20 });
    await expect(
      page.getByRole('img', { name: strings.game.correct }),
    ).toBeVisible();
    if (pauseAfter) {
      await visibility(page, true);
      await expect(
        page.getByRole('button', { name: strings.action.continue }),
      ).toBeVisible();
      await visibility(page, false);
      await page.getByRole('button', { name: strings.action.continue }).click();
    }
    await expect
      .poll(() => firstButton!.evaluate((button) => button.isConnected))
      .toBe(false);
    exercise = next;
    await ready();
  }
  await ready();
  return {
    get exercise() {
      return exercise;
    },
    get adaptation() {
      return adaptation;
    },
    ready,
    correct,
    advance,
    async select(kind: ExerciseKind) {
      if ([...recentKinds, exercise.kind].slice(-2).every((x) => x === kind))
        await advance(false, undefined, true);
      await advance(false, kind, true);
      expect(exercise.kind).toBe(kind);
    },
    async wrong() {
      const label = exercise.options.find(
        (x) => x.id !== exercise.correctOptionId,
      )!.labelTt;
      await page
        .getByRole('button', { name: label, exact: true })
        .dblclick({ delay: 20 });
      await expect(page.getByRole('status')).toHaveText(strings.game.tryAgain);
      await ready();
    },
  };
}
