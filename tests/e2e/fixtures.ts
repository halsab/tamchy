import { test as base, expect, type Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };

export const test = base.extend<{
  checkedPage: Page;
  expectedAudioFailures: Set<string>;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright требует деструктуризацию первого аргумента даже без зависимостей.
  expectedAudioFailures: async ({}, use) => {
    await use(new Set());
  },
  checkedPage: async (
    { page, baseURL, expectedAudioFailures },
    use,
    testInfo,
  ) => {
    const unexpected: string[] = [];
    const expected: string[] = [];
    const root = new URL(baseURL!);
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
  page.getByRole('group', { name: strings.game.answers }).getByRole('button');

export async function answersReady(page: Page) {
  await expect(answerButtons(page)).toHaveCount(2);
  for (const button of await answerButtons(page).all())
    await expect(button).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
}
