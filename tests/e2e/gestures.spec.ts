import type { CDPSession, Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import {
  test,
  expect,
  answersReady,
  currentExercise,
  answerButtons,
} from './fixtures.ts';

test('текст не выделяется и контекстное меню отменяется на всех экранах', async ({
  checkedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['', 'colors', 'animals', 'numbers', 'parents']) {
    await page.goto(`./#/${route}`);
    const text =
      route === 'parents'
        ? page.getByText(strings.parents.ageModeDescription, { exact: true })
        : page.getByRole('heading', { level: 1 });
    await expect(text).toBeVisible();
    await text.click({ trial: true });
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
    const cancelled = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          document.addEventListener(
            'contextmenu',
            (event) => resolve(event.defaultPrevented),
            { once: true },
          );
        }),
    );
    await text.click({ button: 'right' });
    expect(await cancelled).toBe(true);
    await expect(page.getByRole('main')).toBeVisible();
  }
});

async function touchSession(page: Page) {
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await touch.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  return touch;
}

async function pinch(touch: CDPSession, y: number) {
  const points = (distance: number) => [
    { x: 195 - distance, y, id: 1 },
    { x: 195 + distance, y, id: 2 },
  ];
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(25),
  });
  for (let distance = 30; distance <= 130; distance += 10)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(distance),
    });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('пинч и двойной тап сохраняют масштаб, включая текст взрослых', async ({
  checkedPage: page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Нативные touch-события отправляются через Chromium CDP.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await touchSession(page);
  try {
    // Контроль: тот же жест действительно увеличивает страницу без ограничений.
    await page.setContent(
      '<meta name="viewport" content="width=device-width, initial-scale=1"><body style="min-height:100vh"></body>',
    );
    await pinch(touch, 420);
    await expect
      .poll(() => page.evaluate(() => visualViewport!.scale))
      .toBeGreaterThan(1);
    for (const route of ['', 'colors', 'animals', 'numbers', 'parents']) {
      await page.goto(`./#/${route}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (route === 'parents')
        await page.getByRole('dialog').locator('header').click({ trial: true });
      const scale = await page.evaluate(() => visualViewport!.scale);
      await pinch(touch, 420);
      for (let tap = 0; tap < 2; tap++) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: 195, y: route === 'parents' ? 320 : 48, id: 1 }],
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      }
      expect(await page.evaluate(() => visualViewport!.scale)).toBe(scale);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
    }
  } finally {
    await touch.detach();
  }
});

test('долгое касание картинки принимает один ответ после отпускания', async ({
  checkedPage: page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Нативные touch-события отправляются через Chromium CDP.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Хайваннар', exact: true }).click();
  await answersReady(page);
  const { target, textTt } = await currentExercise(page, 'animals');
  const answer = page.getByRole('button', {
    name: target.labelTt,
    exact: true,
  });
  const box = (await answer.locator('img').boundingBox())!;
  const touch = await touchSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
      ],
    });
    // Это длительность удержания пальца, а не ожидание готовности приложения.
    await page.waitForTimeout(1200);
    await expect(answer).toBeEnabled();
    await expect(
      page.getByRole('img', { name: strings.game.correct }),
    ).toHaveCount(0);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(page.getByRole('status')).toHaveText(strings.game.correct);
    for (const button of await answerButtons(page).all())
      await expect(button).toBeDisabled();
    await answersReady(page);
    expect((await currentExercise(page, 'animals')).textTt).not.toBe(textTt);
    await page.getByRole('button', { name: strings.nav.home }).click();
    await expect(page).toHaveURL(/#\/$/);
  } finally {
    await touch.detach();
  }
});
