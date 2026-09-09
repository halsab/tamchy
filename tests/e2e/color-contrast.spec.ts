import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { test, expect, answerButtons, answersReady } from './fixtures.ts';
import { installSeniorRandom, startSeniorPlayer } from './senior-player.ts';

async function visibleContour(canvas: Locator) {
  const outlined = await sharp(await canvas.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer();
  await canvas.evaluate((element) =>
    element.style.setProperty('filter', 'none'),
  );
  let plain: Buffer;
  try {
    plain = await sharp(await canvas.screenshot())
      .ensureAlpha()
      .raw()
      .toBuffer();
  } finally {
    await canvas.evaluate((element) => element.style.removeProperty('filter'));
  }
  let edge = 0,
    white = 0;
  for (let i = 0; i < plain.length; i += 4) {
    if (plain[i]! > 235 && plain[i + 1]! > 235 && plain[i + 2]! > 235) {
      if (
        outlined[i]! < 200 &&
        outlined[i + 1]! < 200 &&
        outlined[i + 2]! < 200
      )
        edge++;
      if (
        outlined[i]! > 240 &&
        outlined[i + 1]! > 240 &&
        outlined[i + 2]! > 240
      )
        white++;
    }
  }
  expect(
    edge,
    'Контур должен быть виден на светлой поверхности',
  ).toBeGreaterThan(20);
  // Полупрозрачная светотень PNG смешивается с фоном при выводе на экран.
  expect(white, 'Светлая заливка остаётся видна').toBeGreaterThan(100);
}

test('контур младших цветовых фишек остаётся только у белого', async ({
  checkedPage: page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.09;
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Төсләр', exact: true }).click();
  await answersReady(page);
  const white = page
    .getByRole('button', { name: 'Ак', exact: true })
    .locator(':scope > span');
  const black = page
    .getByRole('button', { name: 'Кара', exact: true })
    .locator(':scope > span');
  await expect(white).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(white).toHaveCSS('border-top-width', '2px');
  await expect(black).toHaveCSS('border-top-width', '0px');
});

test('белые предметы, фигуры и счётные группы имеют видимый контур без подложки', async ({
  checkedPage: page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installSeniorRandom(page);
  await page.goto('./#/parents');
  await page.getByText(strings.parents.senior, { exact: true }).click();
  await page.getByRole('button', { name: strings.action.close }).click();
  const colors = await startSeniorPlayer(page, 'colors', 0.88);
  expect(colors.exercise.kind).toBe('C2');
  await visibleContour(page.locator('main canvas'));
  for (const button of await answerButtons(page).all()) {
    const white = (await button.getAttribute('aria-label')) === 'Ак';
    await expect(button.locator(':scope > span').first()).toHaveCSS(
      'border-top-width',
      white ? '2px' : '0px',
    );
  }
  for (let i = 0; i < 3; i++) await colors.advance(false, undefined, true);
  await colors.select('C3-B');
  // Название фигуры включает цвет; правильность ответа не влияет на оформление.
  const whiteCanvas = page
    .getByRole('button', { name: /ак / })
    .first()
    .locator('canvas');
  await visibleContour(whiteCanvas);
  for (const button of await answerButtons(page).all()) {
    if (!(await button.getAttribute('aria-label'))!.includes('ак '))
      await expect(button.locator('canvas')).toHaveCSS('filter', 'none');
  }
  await page.screenshot({ path: testInfo.outputPath('white-shapes.png') });
  await page
    .getByRole('button', { name: strings.nav.home, exact: true })
    .click();
  const numbers = await startSeniorPlayer(page, 'numbers', 0.88);
  await numbers.advance(false, undefined, true);
  expect(numbers.exercise.kind).toBe('N1-C');
  await page.setViewportSize({ width: 641, height: 360 });
  for (const canvas of await answerButtons(page).locator('canvas').all()) {
    await expect(canvas).not.toHaveCSS('filter', 'none');
    await visibleContour(canvas);
  }
  await page.screenshot({ path: testInfo.outputPath('white-groups.png') });
});

test('в последовательности C4 рамка есть только у белого, следующая позиция остаётся пунктирной', async ({
  checkedPage: page,
}) => {
  test.setTimeout(60000);
  await installSeniorRandom(page);
  await page.goto('./#/parents');
  await page.getByText(strings.parents.senior, { exact: true }).click();
  await page.getByRole('button', { name: strings.action.close }).click();
  const player = await startSeniorPlayer(page, 'colors', 0.09);
  for (let i = 0; i < 8; i++) await player.advance(false, undefined, true);
  await player.select('C4');
  const white = page.locator('[data-color="white"]');
  expect(await white.count()).toBeGreaterThan(0);
  for (const chip of await page.locator('[data-color]').all()) {
    const isWhite = (await chip.getAttribute('data-color')) === 'white';
    await expect(chip).toHaveCSS('border-top-width', isWhite ? '2px' : '0px');
  }
  await expect(white.first()).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('[data-next]')).toHaveCSS(
    'border-top-style',
    'dashed',
  );
});
