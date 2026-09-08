import { test as base, expect, type Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import type { CategoryId } from '../../src/content/types.ts';
import { juniorPrompts } from '../helpers/junior-content.ts';

export const test = base.extend<{
  checkedPage: Page;
  appRoot: URL;
  expectedAudioFailures: Set<string>;
}>({
  appRoot: async ({ baseURL }, use) => {
    await use(new URL(baseURL!));
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright требует деструктуризацию первого аргумента даже без зависимостей.
  expectedAudioFailures: async ({}, use) => {
    await use(new Set());
  },
  checkedPage: async (
    { page, appRoot: root, expectedAudioFailures },
    use,
    testInfo,
  ) => {
    const unexpected: string[] = [];
    const expected: string[] = [];
    page.on('pageerror', (error) => unexpected.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      const url = message.location().url;
      if (
        expectedAudioFailures.has(url) &&
        /Failed to load resource/.test(message.text())
      )
        expected.push(`${url}: ${message.text()}`);
      else unexpected.push(`${url}: ${message.text()}`);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.origin !== root.origin)
          unexpected.push(`External request: ${url.href}`);
        if (!url.pathname.startsWith(root.pathname))
          unexpected.push(`Outside base: ${url.href}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const message = `${response.status()} ${response.url()}`;
      if (expectedAudioFailures.has(response.url())) expected.push(message);
      else unexpected.push(message);
    });
    await use(page);
    if (expected.length)
      await testInfo.attach('injected-audio-failures', {
        body: expected.join('\n'),
        contentType: 'text/plain',
      });
    expect(unexpected).toEqual([]);
  },
});

export { expect };
export const answerButtons = (page: Page) =>
  page
    .getByRole('group', { name: strings.game.answers, includeHidden: true })
    .getByRole('button', { includeHidden: true });

export async function answersReady(page: Page) {
  await expect
    .poll(() => answerButtons(page).count())
    .toBeGreaterThanOrEqual(2);
  expect(await answerButtons(page).count()).toBeLessThanOrEqual(4);
  // Ресурс имеет срок 15 с, затем вступительная реплика может готовиться ещё до 2 с.
  for (const button of await answerButtons(page).all())
    await expect(button).toBeEnabled({ timeout: 18000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
}

export async function currentExercise(page: Page, categoryId: CategoryId) {
  const text = await page
    .getByRole('group', { name: strings.game.answers, includeHidden: true })
    .evaluate((group) => group.previousElementSibling?.textContent);
  const exercise = juniorPrompts(categoryId).find(
    (exercise) => exercise.textTt === text,
  );
  expect(exercise, `Неизвестное задание: ${text}`).toBeDefined();
  return exercise!;
}
