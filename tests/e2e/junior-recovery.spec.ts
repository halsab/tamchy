import strings from '../../src/content/tt.json' with { type: 'json' };
import { traceAudio } from './audio-trace.ts';
import {
  test,
  expect,
  answersReady,
  answerButtons,
  currentExercise,
} from './fixtures.ts';

test('сбой подтверждения оставляет видимый принятый ответ и восстанавливается без нового зачёта', async ({
  checkedPage: page,
}) => {
  const trace = await traceAudio(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Төсләр', exact: true }).click();
  await answersReady(page);
  const exercise = await currentExercise(page, 'colors');
  await expect
    .poll(async () =>
      (await trace()).starts.slice(-exercise.promptAudio.length),
    )
    .toEqual(exercise.promptAudio);
  await page.evaluate((path) => {
    (window as Window & { failAudioPath?: string }).failAudioPath = path;
  }, exercise.labelAudio);
  await page
    .getByRole('button', { name: exercise.target.labelTt, exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText(strings.game.activate);
  await expect(
    page.getByRole('img', { name: strings.game.correct }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: strings.nav.home }),
  ).toBeInViewport();
  await expect(
    page.getByRole('button', { name: strings.action.listen, exact: true }),
  ).toBeInViewport();
  for (const button of await answerButtons(page).all())
    await expect(button).toBeDisabled();
  await page
    .getByRole('button', { name: strings.action.listen, exact: true })
    .click();
  await expect(
    page.getByText(exercise.textTt, { exact: true }),
  ).not.toBeVisible();
  await answersReady(page);
  await expect(answerButtons(page)).toHaveCount(2);
});
