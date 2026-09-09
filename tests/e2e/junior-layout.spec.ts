import type { Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 } from '../../src/content/v2/catalog.ts';
import {
  test,
  expect,
  answerButtons,
  answersReady,
  currentExercise,
} from './fixtures.ts';

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
  { width: 568, height: 320 },
];

async function measure(page: Page, zoom = false) {
  const result = await page.evaluate(() => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const group = document.querySelector('[role="group"]')!;
    const cards = [...group.querySelectorAll('button')].map((button) => ({
      ...rect(button),
      contained: [...button.querySelectorAll('img, canvas')].every((image) => {
        const a = rect(button),
          b = rect(image);
        return (
          b.left >= a.left &&
          b.right <= a.right + 0.5 &&
          b.top >= a.top &&
          b.bottom <= a.bottom + 0.5
        );
      }),
    }));
    return {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      cards,
      header: rect(document.querySelector('main header')!),
      prompt: rect(group.previousElementSibling!),
    };
  });
  expect(result.width).toBe(page.viewportSize()!.width);
  if (!zoom) expect(result.height).toBe(page.viewportSize()!.height);
  for (const card of result.cards) {
    expect(card.width).toBeGreaterThanOrEqual(128);
    expect(card.height).toBeGreaterThanOrEqual(128);
    expect(card.contained).toBe(true);
    for (const other of [result.header, result.prompt]) {
      const separated =
        card.left >= other.right - 0.5 ||
        card.right <= other.left + 0.5 ||
        card.top >= other.bottom - 0.5 ||
        card.bottom <= other.top + 0.5;
      expect(separated).toBe(true);
    }
  }
  for (let a = 0; a < result.cards.length; a++)
    for (let b = a + 1; b < result.cards.length; b++) {
      const first = result.cards[a]!,
        second = result.cards[b]!;
      const x =
        Math.max(first.left, second.left) - Math.min(first.right, second.right);
      const y =
        Math.max(first.top, second.top) - Math.min(first.bottom, second.bottom);
      expect(Math.max(x, y)).toBeGreaterThanOrEqual(15.9);
    }
}

for (const category of contentV2.categories) {
  test(`${category.labelTt}: настоящие 2/3/4 карточки, пять окон, увеличение и пауза`, async ({
    checkedPage: page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.goto('./');
    await page
      .getByRole('button', { name: category.labelTt, exact: true })
      .click();
    for (const count of [2, 3, 4]) {
      await answersReady(page);
      await expect(answerButtons(page)).toHaveCount(count);
      const exercise = await currentExercise(page, category.id);
      const originals = await answerButtons(page).elementHandles();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await measure(page);
        for (let index = 0; index < count; index++)
          expect(
            await answerButtons(page)
              .nth(index)
              .evaluate(
                (button, original) => button === original,
                originals[index]!,
              ),
          ).toBe(true);
        expect((await currentExercise(page, category.id)).textTt).toBe(
          exercise.textTt,
        );
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await measure(page, true);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '';
        });
        if (viewport.width === 320 && count === 4) {
          const path = testInfo.outputPath(`${category.id}-four-320.png`);
          await page.screenshot({ path });
          await testInfo.attach(`${category.id}-four-320`, {
            path,
            contentType: 'image/png',
          });
        }
      }
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(
        page.getByRole('button', { name: strings.action.continue }),
      ).toBeVisible();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await measure(page);
        await expect(
          page.getByRole('button', { name: strings.nav.home }),
        ).toBeInViewport();
        await expect(
          page.getByRole('button', { name: strings.action.continue }),
        ).toBeInViewport();
      }
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('button', { name: strings.action.continue }).click();
      await answersReady(page);
      expect((await currentExercise(page, category.id)).textTt).toBe(
        exercise.textTt,
      );
      if (count < 4)
        for (let round = 0; round < 5; round++) {
          const current = await currentExercise(page, category.id);
          await page
            .getByRole('button', { name: current.target.labelTt, exact: true })
            .click();
          await expect(page.getByRole('status')).toHaveText(
            strings.game.correct,
          );
          await expect(
            page.getByText(current.textTt, { exact: true }),
          ).not.toBeVisible();
          await answersReady(page);
        }
    }
    for (const count of [4, 3]) {
      for (let round = 0; round < 2; round++) {
        await answersReady(page);
        await expect(answerButtons(page)).toHaveCount(count);
        const exercise = await currentExercise(page, category.id);
        const labels = await answerButtons(page).evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        );
        await page
          .getByRole('button', {
            name: labels.find((label) => label !== exercise.target.labelTt)!,
            exact: true,
          })
          .click();
        await expect(page.getByRole('status')).toHaveText(
          strings.game.tryAgain,
        );
        await answersReady(page);
        await page
          .getByRole('button', { name: exercise.target.labelTt, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(strings.game.correct);
        await expect(
          page.getByText(exercise.textTt, { exact: true }),
        ).not.toBeVisible();
      }
      await answersReady(page);
      await expect(answerButtons(page)).toHaveCount(count - 1);
    }
  });
}
