import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { artifactServer } from './pwa-server.ts';
import { resolve } from 'node:path';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import catalog from '../../src/content/catalog.json' with { type: 'json' };
import { test, expect, answerButtons, answersReady } from './fixtures.ts';

async function imagesReady(page: Page) {
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
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    })),
  ).toEqual(
    expect.objectContaining({
      width: page.viewportSize()!.width,
      height: page.viewportSize()!.height,
    }),
  );
}

// Отказ задаётся только в этом сценарии; остальные тесты требуют настоящую озвучку.
test('меню → три раздела → ошибка загрузки → успешный повтор → домой', async ({
  checkedPage: page,
  expectedAudioFailures,
  appRoot,
}) => {
  const server = await artifactServer(
    resolve('dist'),
    process.env.VITE_BASE ?? '/',
  );
  appRoot.href = server.url;
  const failing = new Set(catalog.categories.map((category) => category.id));
  server.fail((path) => {
    const failure = [...failing].some(
      (id) =>
        path.startsWith(`assets/audio/tt/${id}/`) &&
        path.endsWith('-prompt.mp3'),
    );
    if (failure) expectedAudioFailures.add(new URL(path, server.url).href);
    return failure;
  });
  try {
    await page.goto(server.url);
    await expect(page).toHaveTitle(strings.app.name);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tt');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('button')).toHaveText([
      'Төсләр',
      'Хайваннар',
      'Саннар',
      strings.nav.parents,
    ]);
    for (const category of catalog.categories) {
      await page
        .getByRole('button', { name: category.labelTt, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/${category.id}$`));
      await expect(
        page.getByRole('heading', { name: category.labelTt }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toHaveText(strings.error.audio);
      await expect(answerButtons(page)).toHaveCount(2);
      for (const button of await answerButtons(page).all())
        await expect(button).toBeDisabled();
      failing.delete(category.id);
      const request = page.waitForResponse(
        (response) =>
          response.url().endsWith('-prompt.mp3') && response.status() === 200,
      );
      await page.getByRole('button', { name: strings.action.retry }).click();
      await request;
      await answersReady(page);
      await page.getByRole('button', { name: strings.nav.home }).click();
      await expect(page).toHaveURL(/#\/$/);
    }
  } finally {
    await server.stop();
  }
});

test('прямой адрес, перезагрузка, неизвестный адрес, Назад и Вперёд', async ({
  checkedPage: page,
}) => {
  await page.goto('./#/animals');
  await expect(
    page.getByRole('button', { name: strings.action.listen, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: strings.action.listen, exact: true }),
  ).toBeVisible();
  for (const button of await answerButtons(page).all())
    await expect(button).toBeDisabled();
  await page.getByRole('button', { name: strings.nav.home }).click();
  await page.getByRole('button', { name: strings.nav.parents }).click();
  await expect(page.getByRole('main')).toContainText(
    strings.parents.connection,
  );
  await expect(
    page.getByRole('status', { name: strings.parents.connectionTitle }),
  ).toHaveText(strings.status.offlineReady, { timeout: 30_000 });
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: strings.app.name }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Хайваннар' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: strings.action.listen, exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: strings.app.name }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: strings.nav.parents }),
  ).toBeVisible();
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    location.hash = '#/unknown';
  });
  await expect(page).toHaveURL(/#\/$/);
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: strings.nav.parents }),
  ).toBeVisible();
});

test('клавиатура, фокус и быстрые касания', async ({ checkedPage: page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  const colors = page.getByRole('button', { name: 'Төсләр', exact: true });
  await expect(colors).toBeFocused();
  expect(
    await colors.evaluate((button) => getComputedStyle(button).outlineStyle),
  ).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Төсләр' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: strings.nav.home }),
  ).toBeFocused();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('heading', { name: strings.app.name }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Саннар', exact: true }).dblclick();
  await answersReady(page);
  await page.getByRole('button', { name: strings.nav.home }).click();
});

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
];
for (const viewport of viewports) {
  test(`компоновка ${viewport.width}×${viewport.height}`, async ({
    checkedPage: page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'firefox',
      'Firefox проверяет основные настольные переходы.',
    );
    await page.setViewportSize(viewport);
    for (const route of ['home', 'colors', 'animals', 'numbers', 'parents']) {
      await page.goto(`./#/${route === 'home' ? '' : route}`);
      const title =
        route === 'home'
          ? strings.app.name
          : route === 'parents'
            ? strings.nav.parents
            : catalog.categories.find((category) => category.id === route)!
                .labelTt;
      await expect(
        page.getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
      if (!['home', 'parents'].includes(route))
        await expect(
          page.getByRole('button', {
            name: strings.action.listen,
            exact: true,
          }),
        ).toBeVisible();
      await imagesReady(page);
      if (route !== 'parents') await noOverflow(page);
      const controls = await page.getByRole('button').evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent,
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      );
      for (const control of controls) {
        expect(control.width).toBeGreaterThanOrEqual(56);
        expect(control.height).toBeGreaterThanOrEqual(56);
      }
      if (!['home', 'parents'].includes(route)) {
        const boxes = await answerButtons(page).evaluateAll((buttons) =>
          buttons.map((button) => ({
            x: button.getBoundingClientRect().x,
            width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height,
          })),
        );
        boxes.forEach((box) => {
          expect(box.width).toBeGreaterThanOrEqual(128);
          expect(box.height).toBeGreaterThanOrEqual(128);
        });
        expect(
          boxes[1]!.x - boxes[0]!.x - boxes[0]!.width,
        ).toBeGreaterThanOrEqual(16);
        const originals = await answerButtons(page).elementHandles();
        await page.setViewportSize({
          width: viewport.height,
          height: viewport.width,
        });
        for (let index = 0; index < 2; index++)
          expect(
            await answerButtons(page)
              .nth(index)
              .evaluate(
                (button, original) => button === original,
                originals[index]!,
              ),
          ).toBe(true);
        await page.setViewportSize(viewport);
      }
      if (!['home', 'parents'].includes(route)) {
        await page
          .getByRole('button', { name: strings.action.listen, exact: true })
          .click();
        await answersReady(page);
        await noOverflow(page);
      }
      if (route === 'numbers') {
        const contained = await answerButtons(page).evaluateAll((buttons) =>
          buttons.every((button) => {
            const card = button.getBoundingClientRect();
            if (button.scrollHeight > button.clientHeight) return false;
            return [...button.querySelectorAll('img')].every((image) => {
              const box = image.getBoundingClientRect();
              return (
                box.left >= card.left &&
                box.right <= card.right &&
                box.top >= card.top &&
                box.bottom <= card.bottom
              );
            });
          }),
        );
        expect(contained, 'Яблоки целиком внутри своей карточки').toBe(true);
      }
      if (route === 'home') {
        for (const category of catalog.categories)
          expect(
            (await page
              .getByRole('button', { name: category.labelTt, exact: true })
              .boundingBox())!.height,
          ).toBeGreaterThanOrEqual(112);
      }
      if (
        browserName === 'chromium' &&
        process.env.VITE_BASE === '/' &&
        [390, 768].includes(viewport.width)
      ) {
        const directory =
          process.env.TAMCHY_SCREENSHOTS ??
          join(tmpdir(), 'tamchy-screenshots');
        await mkdir(directory, { recursive: true });
        const path = join(
          directory,
          `${route}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        testInfo.annotations.push({ type: 'screenshot', description: path });
      }
    }
  });
}

test('увеличение текста и reduced motion', async ({
  checkedPage: page,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox',
    'Firefox проверяет основные настольные переходы.',
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of ['', 'colors', 'animals', 'numbers', 'parents']) {
    await page.goto(`./#/${route}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expect(page.getByRole('main')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    for (const button of await page.getByRole('button').all()) {
      const metrics = await button.evaluate((button) => ({
        width: button.clientWidth,
        scroll: button.scrollWidth,
        transform: getComputedStyle(button).transform,
        animation: getComputedStyle(button).animationName,
        transition: getComputedStyle(button).transitionDuration,
      }));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.transform).toBe('none');
      expect(metrics.animation).toBe('none');
      expect(metrics.transition).toBe('0s');
    }
  }
});
