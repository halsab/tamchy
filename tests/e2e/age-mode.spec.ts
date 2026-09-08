import type { Page } from '@playwright/test';
import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 } from '../../src/content/v2/catalog.ts';
import type { AgeMode } from '../../src/services/preferences/age-mode.ts';
import { test, expect, answerButtons, answersReady } from './fixtures.ts';
import { traceAudio } from './audio-trace.ts';

async function chooseMode(page: Page, mode: AgeMode) {
  const sheet = page.getByRole('dialog', { name: strings.nav.parents });
  await sheet.getByText(strings.parents[mode], { exact: true }).click();
  await expect(
    sheet.getByRole('radio', { name: strings.parents[mode] }),
  ).toBeChecked();
  await sheet.getByRole('button', { name: strings.nav.home }).click();
  await expect(sheet).not.toBeVisible();
}

test('выбор возраста управляет всеми разделами, новый вход сохраняет только режим', async ({
  checkedPage: page,
}, testInfo) => {
  test.setTimeout(90000);
  const audio = await traceAudio(page);
  await page.goto('./');
  await expect(page).toHaveTitle(strings.app.name);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tt');
  for (const mode of ['senior', 'junior'] as const) {
    await page.setViewportSize(
      mode === 'senior'
        ? { width: 390, height: 844 }
        : { width: 1024, height: 768 },
    );
    await page.getByRole('button', { name: strings.nav.parents }).click();
    await chooseMode(page, mode);
    await expect(page.getByRole('button')).toHaveText([
      ...contentV2.categories.map((x) => x.labelTt),
      '',
    ]);
    for (const category of contentV2.categories) {
      const started = (await audio()).starts.length;
      await page
        .getByRole('button', { name: category.labelTt, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/${category.id}$`));
      await answersReady(page);
      await expect(answerButtons(page)).toHaveCount(mode === 'senior' ? 4 : 2);
      expect((await audio()).starts.length).toBeGreaterThan(started);
      if (category.id === 'numbers') {
        const path = testInfo.outputPath(`${mode}-numbers.png`);
        await page.screenshot({ path });
        await testInfo.attach(`${mode}-numbers`, {
          path,
          contentType: 'image/png',
        });
      }
      await page.getByRole('button', { name: strings.nav.home }).click();
    }
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({
      'tamchy.age-mode': mode,
    });
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  }
  expect((await audio()).overlaps).toEqual([]);
  expect((await audio()).starts).not.toContain('unknown');
});

for (const mode of ['junior', 'senior'] as const)
  test(`${mode}: прямой вход, перезагрузка и история используют текущий возраст`, async ({
    checkedPage: page,
  }) => {
    test.setTimeout(90000);
    await page.goto('./#/parents');
    await chooseMode(page, mode);
    const other = mode === 'senior' ? 'junior' : 'senior';
    for (const category of contentV2.categories) {
      await page.goto(`./#/${category.id}`);
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        const activate = page.getByRole('button', {
          name: strings.action.listen,
          exact: true,
        });
        await expect(activate).toBeVisible();
        await expect(answerButtons(page)).toHaveCount(
          mode === 'senior' ? 4 : 2,
        );
        for (const button of await answerButtons(page).all())
          await expect(button).toBeDisabled();
        await activate.click();
        await answersReady(page);
      }
      await page.getByRole('button', { name: strings.nav.home }).click();
      await page.getByRole('button', { name: strings.nav.parents }).click();
      const sheet = page.getByRole('dialog', { name: strings.nav.parents });
      await sheet.getByText(strings.parents[other], { exact: true }).click();
      await page.goBack();
      await expect(page).toHaveURL(/#\/$/);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`#/${category.id}$`));
      await expect(
        page.getByRole('button', { name: strings.action.listen, exact: true }),
      ).toBeVisible();
      await expect(answerButtons(page)).toHaveCount(other === 'senior' ? 4 : 2);
      await page
        .getByRole('button', { name: strings.action.listen, exact: true })
        .click();
      await answersReady(page);
      await page.goForward();
      await page.goForward();
      await expect(
        sheet.getByRole('radio', { name: strings.parents[other] }),
      ).toBeChecked();
      await chooseMode(page, mode);
    }
  });

test('без localStorage выбранный возраст действует до перезагрузки', async ({
  checkedPage: page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('./#/parents');
  await chooseMode(page, 'senior');
  await page.getByRole('button', { name: 'Саннар', exact: true }).click();
  await answersReady(page);
  await expect(answerButtons(page)).toHaveCount(4);
  await page.getByRole('button', { name: strings.nav.home }).click();
  await page.getByRole('button', { name: strings.nav.parents }).click();
  await expect(
    page.getByRole('radio', { name: strings.parents.senior }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('radio', { name: strings.parents.junior }),
  ).toBeChecked();
  await chooseMode(page, 'junior');
  await page.getByRole('button', { name: 'Саннар', exact: true }).click();
  await answersReady(page);
  await expect(answerButtons(page)).toHaveCount(2);
});
