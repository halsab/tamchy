import { interactionPath } from '../../src/content/interactions.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contentV2 as catalog } from '../../src/content/v2/catalog.ts';
import { juniorItems } from '../helpers/junior-content.ts';
import { traceAudio } from './audio-trace.ts';
import strings from '../../src/content/tt.json' with { type: 'json' };
import {
  test,
  expect,
  answerButtons,
  answersReady,
  currentExercise,
} from './fixtures.ts';

test('все 189 MP3 из сборки совпадают с исходными файлами и декодируются', async ({
  checkedPage: page,
}) => {
  const recordings = await Promise.all(
    catalog.audio
      .map((clip) => clip.path)
      .map(async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(resolve('public', path)))
          .digest('hex'),
      })),
  );
  expect(recordings).toHaveLength(189);
  await page.goto('./');
  const decoded = await page.evaluate(async (entries) => {
    const context = new AudioContext();
    try {
      const results = [];
      for (const { path } of entries) {
        const response = await fetch(new URL(path, document.baseURI));
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const buffer = await context.decodeAudioData(bytes);
        results.push({
          path,
          sha256: [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
          channels: buffer.numberOfChannels,
          duration: buffer.duration,
        });
      }
      return results;
    } finally {
      await context.close();
    }
  }, recordings);
  expect(decoded.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual(
    recordings,
  );
  for (const recording of decoded) {
    expect(recording.channels, recording.path).toBe(1);
    expect(recording.duration, recording.path).toBeGreaterThan(0);
  }
});

for (const category of catalog.categories) {
  test(`${category.labelTt}: полный цикл с настоящими заданиями и подтверждениями`, async ({
    checkedPage: page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const trace = await traceAudio(page);
    const required = new Set<string>();
    const formulations = new Set<string>();
    const items = juniorItems(category.id);
    await page.goto('./');
    await page
      .getByRole('button', { name: category.labelTt, exact: true })
      .click();
    const historyLength = await page.evaluate(() => history.length);
    const visited = new Set<string>();
    for (
      let round = 0;
      round < items.length ||
      formulations.size < (category.id === 'colors' ? 3 : 5);
      round++
    ) {
      await answersReady(page);
      expect(round).toBeLessThan(items.length * 5);
      const exercise = await currentExercise(page, category.id);
      const { target } = exercise;
      if (round < items.length) expect(visited.has(target.id)).toBe(false);
      visited.add(target.id);
      formulations.add(exercise.recipeId);
      exercise.promptAudio.forEach((path) => required.add(path));
      required.add(exercise.labelAudio);
      await expect
        .poll(async () =>
          (await trace()).starts.slice(-exercise.promptAudio.length),
        )
        .toEqual(exercise.promptAudio);

      if (round === 0) {
        const labels = await answerButtons(page).evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        );
        const wrong = labels.find((label) => label !== target.labelTt)!;
        for (let attempt = 0; attempt < 2; attempt++) {
          await page.getByRole('button', { name: wrong, exact: true }).click();
          await expect(page.getByRole('status')).toHaveText(
            strings.game.tryAgain,
          );
          await answersReady(page);
          await expect(
            page.getByText(exercise.textTt, { exact: true }),
          ).toBeVisible();
          expect(
            await answerButtons(page).evaluateAll((buttons) =>
              buttons.map((button) => button.getAttribute('aria-label')),
            ),
          ).toEqual(labels);
        }
        await expect(
          page.getByText(strings.game.hint, { exact: true }),
        ).toBeAttached();
        await page
          .getByRole('button', { name: strings.action.listenAgain })
          .click();
        await answersReady(page);
        await expect(
          page.getByText(exercise.textTt, { exact: true }),
        ).toBeVisible();
      }

      await expect
        .poll(async () =>
          (await trace()).starts.slice(-exercise.promptAudio.length),
        )
        .toEqual(exercise.promptAudio);
      const beforeAnswer = (await trace()).starts.length;
      await page
        .getByRole('button', { name: target.labelTt, exact: true })
        .click();
      await expect(page.getByRole('status')).toHaveText(strings.game.correct);
      for (const button of await answerButtons(page).all())
        await expect(button).toBeDisabled();
      const confirmation =
        round % 2 === 0
          ? [
              interactionPath(
                (['correct', 'well-done', 'very-good'] as const)[
                  (round / 2) % 3
                ]!,
              ),
              exercise.labelAudio,
            ]
          : [exercise.labelAudio];
      await expect
        .poll(async () =>
          (await trace()).starts.slice(
            beforeAnswer,
            beforeAnswer + confirmation.length,
          ),
        )
        .toEqual(confirmation);
      await expect(
        page.getByText(exercise.textTt, { exact: true }),
      ).not.toBeVisible();
      await answersReady(page);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
      await expect(page).toHaveURL(new RegExp(`#/${category.id}$`));
    }
    expect([...visited].sort()).toEqual(items.map((item) => item.id).sort());
    const playback = await trace();
    for (const path of required) expect(playback.starts, path).toContain(path);
    expect(playback.overlaps).toEqual([]);
    await testInfo.attach('audio-evidence', {
      body: JSON.stringify({
        targets: [...visited],
        formulations: [...formulations],
        required: [...required],
        playback,
      }),
      contentType: 'application/json',
    });
    await page.getByRole('button', { name: strings.nav.home }).click();
    await expect(
      page.getByRole('heading', { name: strings.app.name }),
    ).toBeVisible();
  });
}

test('реальные реплики идут перед учебной записью и прекращаются при выходе', async ({
  checkedPage: page,
}) => {
  const category = catalog.categories[0]!;
  const trace = await traceAudio(page);
  const starts = async () => (await trace()).starts;
  await page.goto('./');
  expect(await starts()).toEqual([]);
  await page
    .getByRole('button', { name: category.labelTt, exact: true })
    .click();
  await answersReady(page);
  const exercise = await currentExercise(page, category.id);
  const { target } = exercise;
  const expected = [interactionPath('hello'), ...exercise.promptAudio];
  await expect.poll(starts).toEqual(expected);
  const labels = await answerButtons(page).evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')),
  );
  const wrong = labels.find((label) => label !== target.labelTt)!;
  for (const introduction of ['think-again', 'hint', 'try-again'] as const) {
    await page.getByRole('button', { name: wrong, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(strings.game.tryAgain);
    await answersReady(page);
    expected.push(interactionPath(introduction), ...exercise.promptAudio);
    await expect.poll(starts).toEqual(expected);
  }
  await page.getByRole('button', { name: target.labelTt, exact: true }).click();
  expected.push(interactionPath('correct'), exercise.labelAudio);
  await expect
    .poll(async () => (await starts()).slice(0, expected.length))
    .toEqual(expected);
  // Короткое название может закончиться до следующего опроса теста; выход проверяем в новом задании.
  await expect(
    page.getByText(exercise.textTt, { exact: true }),
  ).not.toBeVisible();
  await answersReady(page);
  const next = await currentExercise(page, category.id);
  expected.push(...next.promptAudio);
  await expect.poll(starts).toEqual(expected);
  await page.getByRole('button', { name: strings.nav.home }).click();
  await expect(
    page.getByRole('heading', { name: strings.app.name }),
  ).toBeVisible();
  expected.push(interactionPath('goodbye'));
  await expect.poll(starts).toEqual(expected);
  await page
    .getByRole('button', { name: category.labelTt, exact: true })
    .click();
  await answersReady(page);
  expect((await starts()).slice(expected.length, expected.length + 1)).toEqual([
    interactionPath('game-start'),
  ]);
  expect((await trace()).overlaps).toEqual([]);
  expect((await starts()).length).toBeGreaterThanOrEqual(expected.length + 2);
});
