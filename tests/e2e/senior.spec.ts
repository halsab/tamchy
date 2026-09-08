import strings from '../../src/content/tt.json' with { type: 'json' };
import { contentV2 } from '../../src/content/v2/catalog.ts';
import {
  audioClipIds,
  exerciseDefinitions,
  type ExerciseKind,
} from '../../src/domain/game/exercise.ts';
import { test, expect, answerButtons } from './fixtures.ts';
import { traceAudio } from './audio-trace.ts';
import {
  installSeniorRandom,
  startSeniorPlayer,
  visibility,
} from './senior-player.ts';

test.use({ actionTimeout: 15000 });

for (const category of contentV2.categories)
  test(`${category.id}: все старшие виды, адаптация, компоновка и восстановление`, async ({
    checkedPage: page,
  }, testInfo) => {
    test.setTimeout(300000);
    await installSeniorRandom(page);
    const audio = await traceAudio(page);
    await page.goto('./#/parents');
    await page.getByText(strings.parents.senior, { exact: true }).click();
    await page.getByRole('button', { name: strings.nav.home }).click();
    const player = await startSeniorPlayer(page, category.id);
    const counts = new Set([player.adaptation.answerCount]);
    for (
      let round = 0;
      round < 15 && player.adaptation.answerCount < 6;
      round++
    ) {
      await player.advance(false, undefined, true);
      counts.add(player.adaptation.answerCount);
    }
    expect(player.adaptation.answerCount).toBe(6);
    expect([...counts]).toEqual([4, 5, 6]);
    const kinds = (Object.keys(exerciseDefinitions) as ExerciseKind[]).filter(
      (kind) => exerciseDefinitions[kind].categoryId === category.id,
    );
    for (const kind of kinds) {
      await player.select(kind);
      const exercise = player.exercise;
      const originals = await answerButtons(page).elementHandles();
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [768, 1024],
        [1024, 768],
        [844, 390],
        [568, 320],
      ]) {
        await page.setViewportSize({ width: width!, height: height! });
        for (const zoom of [false, true]) {
          await page.evaluate((zoom) => {
            document.documentElement.style.fontSize = zoom ? '200%' : '';
          }, zoom);
          const size = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }));
          expect(size.width).toBe(width);
          if (!zoom) expect(size.height).toBe(height);
          for (const button of originals)
            expect(await button.evaluate((button) => button.isConnected)).toBe(
              true,
            );
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const screenshot = testInfo.outputPath(`${kind}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(kind, {
        path: screenshot,
        contentType: 'image/png',
      });
      await player.wrong();
      await player.wrong();
      await expect(player.correct()).toHaveAccessibleDescription(
        strings.game.hint,
      );
      await page
        .getByRole('button', { name: strings.action.listenAgain })
        .click();
      await player.ready();
      await visibility(page, true);
      await expect(
        page.getByRole('button', { name: strings.action.continue }),
      ).toBeVisible();
      await visibility(page, false);
      await page.getByRole('button', { name: strings.action.continue }).click();
      await player.ready();
      for (const button of originals)
        expect(await button.evaluate((button) => button.isConnected)).toBe(
          true,
        );
      const prompt = audioClipIds(exercise.prompt.audio).map(
        (id) => contentV2.audio.find((x) => x.id === id)!.path,
      );
      await expect
        .poll(async () => (await audio()).starts.slice(-prompt.length), {
          timeout: 15000,
        })
        .toEqual(prompt);
      const starts = (await audio()).starts.length;
      const confirmation = audioClipIds(exercise.confirmation).map(
        (id) => contentV2.audio.find((x) => x.id === id)!.path,
      );
      await page.evaluate((path) => {
        (window as Window & { failAudioPath?: string }).failAudioPath = path;
      }, confirmation[0]!);
      await Promise.all([
        player.advance(true),
        (async () => {
          await expect(page.getByRole('status')).toHaveText(
            strings.game.activate,
          );
          await expect(
            page.getByRole('img', { name: strings.game.correct }),
          ).toBeVisible();
          for (const button of await answerButtons(page).all())
            await expect(button).toBeDisabled();
          await page
            .getByRole('button', { name: strings.action.listen, exact: true })
            .click();
        })(),
      ]);
      const actual = (await audio()).starts.slice(starts);
      expect(actual.join('|')).toContain(confirmation.join('|'));
    }
    await page.getByRole('button', { name: strings.nav.home }).click();
    const trace = await audio();
    expect(trace.overlaps).toEqual([]);
    expect(trace.starts).not.toContain('unknown');
    await testInfo.attach('senior-flow', {
      body: JSON.stringify({
        kinds,
        counts: [...counts],
        starts: trace.starts,
      }),
      contentType: 'application/json',
    });
  });
