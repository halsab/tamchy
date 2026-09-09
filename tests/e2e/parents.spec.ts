import strings from '../../src/content/tt.json' with { type: 'json' };
import { test, expect, answerButtons, answersReady } from './fixtures.ts';
import type { Page } from '@playwright/test';

const sheet = (page: Page) =>
  page.getByRole('dialog', { name: strings.nav.parents });
const settings = (page: Page) =>
  page.getByRole('button', { name: strings.nav.parents });

async function openSheet(page: Page) {
  await settings(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(
    sheet(page).getByRole('button', { name: strings.action.close }),
  ).toBeFocused();
}

async function dragHeader(page: Page, distance: number) {
  const header = sheet(page).locator('header');
  await expect(header).toBeVisible();
  // Пробный клик ждёт завершения открытия, не начиная жест.
  await header.click({ trial: true });
  const box = (await header.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 14;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 12 });
  return { x, y };
}

test('шестерёнка, шит, сохранённый возраст и старшая игра', async ({
  checkedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(settings(page)).toHaveText('');
  const button = (await settings(page).boundingBox())!;
  expect(button.width).toBeGreaterThanOrEqual(56);
  expect(button.height).toBeGreaterThanOrEqual(56);
  expect(button.x + button.width).toBeLessThanOrEqual(390 - 16);
  expect(button.y + button.height).toBeLessThanOrEqual(844 - 16);
  expect(button.x).toBeGreaterThan(300);
  expect(button.y).toBe(16);
  await openSheet(page);
  await expect(page).toHaveURL(/#\/parents$/);
  await expect(
    sheet(page).getByRole('radio', { name: strings.parents.junior }),
  ).toBeChecked();
  await sheet(page).getByText(strings.parents.senior, { exact: true }).click();
  await expect(
    sheet(page).getByRole('radio', { name: strings.parents.senior }),
  ).toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem('tamchy.age-mode')),
  ).toBe('senior');
  await page.reload();
  await expect(
    sheet(page).getByRole('radio', { name: strings.parents.senior }),
  ).toBeChecked();
  await sheet(page).getByRole('button', { name: strings.action.close }).click();
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
  await page.getByRole('button', { name: 'Саннар', exact: true }).click();
  await answersReady(page);
  await expect(answerButtons(page)).toHaveCount(4);
});

test('фокус остаётся в шите; Escape, фон и история закрывают его', async ({
  checkedPage: page,
}) => {
  await page.goto('./');
  await openSheet(page);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(
      await sheet(page).evaluate((dialog) =>
        dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
  await openSheet(page);
  await sheet(page).click({ position: { x: 4, y: 4 } });
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
  await openSheet(page);
  await page.goBack();
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
  await page.goForward();
  await expect(sheet(page)).toBeVisible();
  await page.goto('./#/parents');
  await sheet(page).getByRole('button', { name: strings.action.close }).click();
  await expect(sheet(page)).not.toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test('панель следует за пальцем; короткий жест и отмена возвращают, длинный закрывает', async ({
  checkedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await openSheet(page);
  const header = sheet(page).locator('header');
  await header.click({ trial: true });
  const initial = (await header.boundingBox())!.y;
  await dragHeader(page, 12);
  expect((await header.boundingBox())!.y).toBeGreaterThan(initial + 8);
  await page.mouse.up();
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(initial, 0);
  const captured = header
    .locator('[aria-hidden="true"]')
    .first()
    .evaluate(
      (element) =>
        new Promise<number>((resolve) => {
          element.addEventListener(
            'gotpointercapture',
            (event) => resolve((event as PointerEvent).pointerId),
            { once: true },
          );
        }),
    );
  const gesture = await dragHeader(page, 130);
  await header
    .locator('[aria-hidden="true"]')
    .first()
    .dispatchEvent('pointercancel', { pointerId: await captured });
  await page.mouse.up();
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(initial, 0);
  await dragHeader(page, 130);
  await page.mouse.move(gesture.x, gesture.y + 15, { steps: 10 });
  await page.mouse.up();
  await expect(sheet(page)).toBeVisible();
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(initial, 0);
  await dragHeader(page, 150);
  await page.mouse.up();
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
});

test('прокрутка текста сохраняет шапку и не закрывает шит', async ({
  checkedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./#/parents');
  const heading = sheet(page).getByRole('heading', {
    name: strings.nav.parents,
  });
  await sheet(page).locator('header').click({ trial: true });
  const before = (await heading.boundingBox())!.y;
  await sheet(page)
    .getByText(strings.parents.liability)
    .scrollIntoViewIfNeeded();
  await expect(sheet(page).getByText(strings.parents.liability)).toBeVisible();
  expect((await heading.boundingBox())!.y).toBeCloseTo(before, 0);
  await expect(
    sheet(page).getByRole('button', { name: strings.action.close }),
  ).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await sheet(page)
    .getByText(strings.parents.about, { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(sheet(page)).toBeVisible();
});

test('уменьшение движения и отказ хранилища сохраняют управление', async ({
  checkedPage: page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('./#/parents');
  await sheet(page).getByText(strings.parents.senior, { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).not.toBeVisible();
  await openSheet(page);
  await expect(
    sheet(page).getByRole('radio', { name: strings.parents.senior }),
  ).toBeChecked();
  const header = sheet(page).locator('header');
  const before = (await header.boundingBox())!.y;
  await dragHeader(page, 150);
  expect((await header.boundingBox())!.y).toBe(before);
  await page.mouse.up();
  await expect(sheet(page)).not.toBeVisible();
});

test('сенсорная прокрутка не закрывает панель; свайп за шапку закрывает', async ({
  checkedPage: page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Нативные touch-события отправляются через Chromium CDP.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/parents');
  const header = sheet(page).locator('header');
  await header.click({ trial: true });
  const top = (await header.boundingBox())!.y;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  const point = (y: number, id = 1) => ({ x: 195, y, id });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(700)],
  });
  for (let y = 690; y >= 470; y -= 10) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(y)],
    });
  }
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(sheet(page)).toBeVisible();
  expect((await header.boundingBox())!.y).toBe(top);
  await expect
    .poll(() =>
      sheet(page)
        .locator('fieldset')
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeLessThan(top);
  const start = top + 14;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(start)],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(start), { x: 230, y: start, id: 2 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [point(start), { x: 230, y: start + 120, id: 2 }],
  });
  expect((await header.boundingBox())!.y).toBe(top);
  for (let dy = 10; dy <= 150; dy += 10) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(start + dy), { x: 230, y: start + 120, id: 2 }],
    });
  }
  expect((await header.boundingBox())!.y).toBeGreaterThan(top + 100);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
  await touch.detach();
});

test('быстрое возвращение по истории продолжает движение с текущего положения', async ({
  checkedPage: page,
}) => {
  await page.goto('./');
  await openSheet(page);
  await sheet(page).locator('header').click({ trial: true });
  const movement = await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const traverse = (direction: 'back' | 'forward') =>
      new Promise<number>((resolve) => {
        addEventListener('popstate', () => resolve(offset()), { once: true });
        history[direction]();
      });
    const panel = document.querySelector('dialog > div')!;
    const offset = () =>
      new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42;
    await traverse('back');
    await frame();
    await frame();
    // Сравниваем кадры на границе смены направления, а не предыдущий кадр закрытия.
    const before = await traverse('forward');
    await frame();
    return { before, after: offset() };
  });
  expect(movement.after).toBeLessThanOrEqual(movement.before + 1);
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).not.toBeVisible();
  await expect(settings(page)).toBeFocused();
});

test('повторное открытие сбрасывает прокрутку; заголовок не служит ручкой', async ({
  checkedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await openSheet(page);
  await sheet(page)
    .getByText(strings.parents.liability)
    .scrollIntoViewIfNeeded();
  await sheet(page).getByRole('button', { name: strings.action.close }).click();
  await expect(sheet(page)).not.toBeVisible();
  await openSheet(page);
  await expect(
    sheet(page).getByText(strings.parents.settingsTitle),
  ).toBeInViewport();
  const header = sheet(page).locator('header');
  await header.click({ trial: true });
  const heading = sheet(page).getByRole('heading', {
    name: strings.nav.parents,
  });
  const box = (await heading.boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y + 160, { steps: 10 });
  await page.mouse.up();
  await expect(sheet(page)).toBeVisible();
  expect((await heading.boundingBox())!.y).toBeCloseTo(box.y, 0);
});
