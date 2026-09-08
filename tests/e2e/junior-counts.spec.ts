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
        const pictures = [...button.querySelectorAll('img')];
        let count = pictures.length;
        if (canvas) {
          const context = canvas.getContext('2d')!;
          const occupied = new Set<number>();
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          for (let index = 3; index < pixels.length; index += 4)
            if (pixels[index]) {
              const pixel = (index - 3) / 4;
              occupied.add(
                Math.floor((pixel % canvas.width) / 112) +
                  4 * Math.floor(pixel / canvas.width / 112),
              );
            }
          count = occupied.size;
        }
        return {
          value: Number(button.textContent),
          count,
          image: pictures[0]?.getAttribute('src'),
          canvas: Boolean(canvas),
        };
      }),
    );
    for (const card of cards) expect(card.count).toBe(card.value);
    if (!cards[0]!.canvas) {
      const hash = await page.evaluate(async (url) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }, cards[0]!.image!);
      expect(hash).toBe(rasterHash);
      expect(cards.every((card) => card.image === cards[0]!.image)).toBe(true);
    }
    const path = cards[0]!.canvas
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
