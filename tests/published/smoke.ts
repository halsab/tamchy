import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { contentV2 as catalog } from '../../src/content/v2/catalog.ts';
import strings from '../../src/content/tt.json' with { type: 'json' };

const [address, release] = process.argv.slice(2);
assert(address && release);
const output = process.env.TAMCHY_PUBLISHED_REPORTS ?? 'reports/published';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
const errors: string[] = [];
const audio: {
  category: string;
  url: string;
  duration: number;
  channels: number;
}[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
context.on('response', (response) => {
  if (response.status() >= 400)
    errors.push(`${response.status()} ${response.url()}`);
});
context.on('request', (request) => {
  const url = new URL(request.url());
  if (
    /^https?:$/.test(url.protocol) &&
    (url.origin !== new URL(address).origin ||
      !url.pathname.startsWith(new URL(address).pathname))
  )
    errors.push(`Запрос вне приложения: ${url.href}`);
});
try {
  await page.goto(address);
  await expect(page).toHaveTitle(strings.app.name);
  await expect(page.getByRole('button')).toHaveText([
    ...catalog.categories.map((category) => category.labelTt),
    '',
  ]);
  await expect(page.getByRole('button').last()).toHaveAccessibleName(
    strings.nav.parents,
  );
  for (const category of catalog.categories) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/assets/audio/tt/clips/${category.id === 'colors' ? 'color' : category.id === 'animals' ? 'animal' : 'number'}-`,
          ) && response.status() === 200,
    );
    await page
      .getByRole('button', { name: category.labelTt, exact: true })
      .click();
    const response = await responsePromise;
    await expect(
      page.getByRole('heading', { name: category.labelTt }),
    ).toBeVisible();
    const answers = page
      .getByRole('group', { name: strings.game.answers })
      .getByRole('button');
    await expect(answers).toHaveCount(2);
    await expect(answers.nth(0)).toBeEnabled({ timeout: 20000 });
    await expect(answers.nth(1)).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const decoded = await page.evaluate(async (url) => {
      const audio = new AudioContext();
      try {
        const buffer = await audio.decodeAudioData(
          await (await fetch(url)).arrayBuffer(),
        );
        return { duration: buffer.duration, channels: buffer.numberOfChannels };
      } finally {
        await audio.close();
      }
    }, response.url());
    assert(decoded.duration > 0 && decoded.channels === 1);
    audio.push({ category: category.id, url: response.url(), ...decoded });
    await page
      .getByRole('button', { name: strings.nav.home, exact: true })
      .click();
    await expect(page).toHaveURL(`${address}#/`);
    await expect(
      page.getByRole('button', { name: category.labelTt, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole('button', { name: strings.nav.parents, exact: true })
    .click();
  await expect(page.getByText(release, { exact: false })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.scriptURL;
        }),
      { timeout: 120000 },
    )
    .toBe(new URL('sw.js', address).href);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'smoke.json'),
    JSON.stringify(
      {
        passed: true,
        url: address,
        release,
        browser: browser.version(),
        audio,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    .screenshot({ path: join(output, 'failure.png'), fullPage: true })
    .catch(() => {});
  await writeFile(
    join(output, 'smoke.json'),
    JSON.stringify(
      { passed: false, errors, audio, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.tracing.stop({ path: join(output, 'trace.zip') });
  await browser.close();
}
