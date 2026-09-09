import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 } from '../../src/content/v2/catalog.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  test,
  expect,
  answersReady,
  answerButtons,
  currentExercise,
} from './fixtures.ts';

test('все 13 счётных объектов рисуются настоящим worker; цифра совпадает с числом предметов', async ({
  checkedPage: page,
}, testInfo) => {
  test.setTimeout(100_000);
  const raster = contentV2.countObjects.find(
    (object) => object.kind === 'raster',
  )!;
  const rasterHash = createHash('sha256')
    .update(await readFile(`public/${raster.image}`))
    .digest('hex');
  await page.addInitScript(() => {
    const paths: string[] = [];
    (window as Window & { tintPaths?: string[] }).tintPaths = paths;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message,
      transfer?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (typeof message?.path === 'string') paths.push(message.path);
      Reflect.apply(post, this, [message, transfer]);
    };
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Саннар', exact: true }).click();
  const seen = new Set<string>();
  for (let round = 0; round < 13; round++) {
    await answersReady(page);
    const exercise = await currentExercise(page, 'numbers');
    const cards = await answerButtons(page).evaluateAll((buttons) =>
      buttons.map((button) => {
        const canvas = button.querySelector('canvas');
        let count = 0;
        if (canvas) {
          const context = canvas.getContext('2d')!;
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          // Считаем отдельные видимые рисунки по проекции каждого ряда,
          // включая центрированный неполный ряд с дробным смещением ячеек.
          for (let row = 0; row < canvas.height / 120; row++) {
            let previous = false;
            for (let x = 0; x < canvas.width; x++) {
              let occupied = false;
              for (let y = row * 120; y < (row + 1) * 120; y++)
                if (pixels[(y * canvas.width + x) * 4 + 3]! >= 8) {
                  occupied = true;
                  break;
                }
              if (occupied && !previous) count++;
              previous = occupied;
            }
          }
        }
        return {
          value: Number(button.textContent),
          count,
          image: canvas?.getAttribute('data-image'),
          canvas: Boolean(canvas),
        };
      }),
    );
    for (const card of cards) expect(card.count).toBe(card.value);
    if (cards[0]!.image) {
      const hash = await page.evaluate(async (url) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }, cards[0]!.image!);
      expect(hash).toBe(rasterHash);
      expect(cards.every((card) => card.image === cards[0]!.image)).toBe(true);
    }
    const path = !cards[0]!.image
      ? await page.evaluate(() =>
          (window as Window & { tintPaths?: string[] }).tintPaths!.at(-1)!,
        )
      : raster.image;
    const object = contentV2.countObjects.find((object) =>
      path.endsWith(object.image),
    );
    expect(object, path).toBeDefined();
    expect(seen.has(object!.id)).toBe(false);
    seen.add(object!.id);
    const screenshot = testInfo.outputPath(`${object!.id}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(object!.id, {
      path: screenshot,
      contentType: 'image/png',
    });
    await page
      .getByRole('button', { name: exercise.target.labelTt, exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText(strings.game.correct);
    await expect(
      page.getByText(exercise.textTt, { exact: true }),
    ).not.toBeVisible();
  }
  expect([...seen].sort()).toEqual(
    contentV2.countObjects.map((object) => object.id).sort(),
  );
});
