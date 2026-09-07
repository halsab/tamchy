import {
  interactionIds,
  interactionPath,
} from '../../src/content/interactions.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import catalog from '../../src/content/catalog.json' with { type: 'json' };
import strings from '../../src/content/tt.json' with { type: 'json' };
import { test, expect, answerButtons, answersReady } from './fixtures.ts';

test('все 42 MP3 из сборки совпадают с исходными файлами и декодируются', async ({
  checkedPage: page,
}) => {
  const recordings = await Promise.all(
    catalog.categories
      .flatMap((category) =>
        category.items.flatMap((item) => [item.labelAudio, item.promptAudio]),
      )
      .concat(interactionIds.map(interactionPath))
      .map(async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(resolve('public', path)))
          .digest('hex'),
      })),
  );
  expect(recordings).toHaveLength(42);
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
  }) => {
    const received = new Set<string>();
    page.on('response', (response) => {
      // WebKit/Firefox сообщают сетевой 304 при успешной ревалидации HTTP-кэша.
      if (response.ok() || response.status() === 304)
        received.add(new URL(response.url()).pathname);
    });
    await page.goto('./');
    await page
      .getByRole('button', { name: category.labelTt, exact: true })
      .click();
    const historyLength = await page.evaluate(() => history.length);
    const visited = new Set<string>();
    for (let round = 0; round < category.items.length; round++) {
      await answersReady(page);
      const text = await page.getByRole('main').innerText();
      const target = category.items.find((item) =>
        text.includes(item.promptTt),
      )!;
      expect(target).toBeDefined();
      expect(visited.has(target.id)).toBe(false);
      visited.add(target.id);

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
            page.getByText(target.promptTt, { exact: true }),
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
          page.getByText(target.promptTt, { exact: true }),
        ).toBeVisible();
      }

      await page
        .getByRole('button', { name: target.labelTt, exact: true })
        .click();
      await expect(page.getByRole('status')).toHaveText(strings.game.correct);
      for (const button of await answerButtons(page).all())
        await expect(button).toBeDisabled();
      await expect(
        page.getByText(target.promptTt, { exact: true }),
      ).not.toBeVisible();
      await answersReady(page);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
      await expect(page).toHaveURL(new RegExp(`#/${category.id}$`));
    }
    expect([...visited].sort()).toEqual(
      category.items.map((item) => item.id).sort(),
    );
    for (const item of category.items) {
      for (const path of [item.promptAudio, item.labelAudio])
        expect(
          [...received].some((url) => url.endsWith(`/${path}`)),
          path,
        ).toBe(true);
    }
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
  const paths = [
    ...category.items.flatMap((item) => [item.labelAudio, item.promptAudio]),
    ...interactionIds.map(interactionPath),
  ];
  const known = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        createHash('sha256')
          .update(await readFile(resolve('public', path)))
          .digest('hex'),
        path,
      ]),
    ),
  );
  await page.addInitScript((known) => {
    const starts: string[] = [];
    (window as Window & { audioStarts?: string[] }).audioStarts = starts;
    const buffers = new WeakMap<AudioBuffer, string>();
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data) {
      const digest = await crypto.subtle.digest('SHA-256', data.slice(0));
      const buffer = await decode.call(this, data);
      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      buffers.set(buffer, known[hash] ?? 'unknown');
      return buffer;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      starts.push(
        this.buffer ? (buffers.get(this.buffer) ?? 'unknown') : 'empty',
      );
    };
  }, known);
  const starts = () =>
    page.evaluate(
      () => (window as Window & { audioStarts?: string[] }).audioStarts ?? [],
    );
  await page.goto('./');
  expect(await starts()).toEqual([]);
  await page
    .getByRole('button', { name: category.labelTt, exact: true })
    .click();
  await answersReady(page);
  const text = await page.getByRole('main').innerText();
  const target = category.items.find((item) => text.includes(item.promptTt))!;
  const expected = [interactionPath('hello'), target.promptAudio];
  expect(await starts()).toEqual(expected);
  const labels = await answerButtons(page).evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')),
  );
  const wrong = labels.find((label) => label !== target.labelTt)!;
  for (const introduction of ['think-again', 'hint', 'try-again'] as const) {
    await page.getByRole('button', { name: wrong, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(strings.game.tryAgain);
    await answersReady(page);
    expected.push(interactionPath(introduction), target.promptAudio);
    expect(await starts()).toEqual(expected);
  }
  await page.getByRole('button', { name: target.labelTt, exact: true }).click();
  expected.push(interactionPath('correct'), target.labelAudio);
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
  expect(await starts()).toHaveLength(expected.length + 2);
});
