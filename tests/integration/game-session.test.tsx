// @vitest-environment jsdom
import { act, cleanup, configure, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup } from '../helpers/session-ui.tsx';
import { deferred } from '../helpers/browser.ts';

beforeEach(() => {
  vi.useFakeTimers();
  configure({ asyncWrapper: async (callback) => act(callback) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('верный ответ: название, обе задержки и ровно один новый раунд', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const target = screen.getByTestId('target').textContent!;
  const oldEnd = s.learningSources[0]!.onended!;
  await s.click('Җавап');
  await s.click('Җавап');
  await s.click('Кабатла');
  expect(screen.getByTestId('state')).toHaveTextContent('correct');
  expect(
    s.fetch.mock.calls
      .filter(([path]) => !String(path).includes('/interaction/'))
      .at(-1)?.[0],
  ).toBe(`/assets/audio/tt/clips/${target}.mp3`);
  expect(s.learningSources).toHaveLength(2);
  act(oldEnd);
  await act(() => vi.advanceTimersByTimeAsync(1100));
  act(() => s.learningSources[1]!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  await act(() => vi.advanceTimersByTimeAsync(1));
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('2');
  expect(screen.getByTestId('target')).not.toHaveTextContent(target);
  expect(s.learningSources).toHaveLength(3);
});

it('неверные ответы повторяют исходное задание; после второго есть подсказка', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const options = screen.getByTestId('options').textContent!;
  for (let count = 0; count < 2; count++) {
    await s.click('Ялгыш');
    expect(screen.getByTestId('state')).toHaveTextContent('retrying');
    expect(s.learningSources.at(-1)!.onended).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(screen.getByTestId('state')).toHaveTextContent('retrying');
    await act(() => vi.advanceTimersByTimeAsync(1));
    await s.settle();
    expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
    expect(screen.getByTestId('round')).toHaveTextContent('1');
    expect(screen.getByTestId('options')).toHaveTextContent(options);
  }
  expect(screen.getByTestId('hint')).toHaveTextContent('hint');
  expect(s.learningSources).toHaveLength(3);
  expect(
    s.fetch.mock.calls.filter(
      ([path]) => !String(path).includes('/interaction/'),
    ),
  ).toHaveLength(5);
  expect(
    s.fetch.mock.calls
      .filter(([path]) => String(path).includes('/interaction/'))
      .map(([path]) => path),
  ).toEqual([
    '/assets/audio/tt/interaction/hello.mp3',
    '/assets/audio/tt/interaction/think-again.mp3',
    '/assets/audio/tt/interaction/hint.mp3',
  ]);
});

it('повтор, активность, пауза, выход и поздние окончания не оживляют прежнюю работу', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const oldEnd = s.learningSources[0]!.onended!;
  await s.click('Кабатла');
  expect(s.learningSources).toHaveLength(2);
  act(() => {
    oldEnd();
    s.learningSources[1]!.onended!();
  });
  await s.settle();
  act(() => s.learningSources.at(-1)!.onended!());
  await s.settle();
  await s.click('Кагылу');
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(s.learningSources).toHaveLength(3);
  act(() => s.changeState('suspended'));
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  act(() => s.changeState('running'));
  expect(s.learningSources).toHaveLength(3);
  await s.click('Дәвам ит');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  const late = s.learningSources.at(-1)!.onended!;
  await s.click('Өйгә');
  act(late);
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(screen.getByTestId('state')).toHaveTextContent('ended');
  expect(s.learningSources).toHaveLength(4);
});

it('ошибка подтверждения повторяет название без повторного зачёта', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const makeSource = s.context.createBufferSource.getMockImplementation()!;
  s.context.createBufferSource
    .mockImplementationOnce(makeSource)
    .mockImplementationOnce(() => {
      const source = makeSource();
      source.start.mockImplementationOnce(() => {
        throw new Error('private browser error');
      });
      return source;
    });
  await s.click('Җавап');
  expect(screen.getByTestId('state')).toHaveTextContent('error');
  await s.click('Җавап');
  expect(screen.getByTestId('state')).toHaveTextContent('error');
  await s.click('Яңадан');
  expect(screen.getByTestId('state')).toHaveTextContent('correct');
  act(() => s.learningSources.at(-1)!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(1200));
  await s.settle();
  expect(screen.getByTestId('round')).toHaveTextContent('2');
  expect(s.learningSources).toHaveLength(3);
});

it('заблокированный и зависший resume восстанавливаются явным действием; выход не ждёт Promise', async () => {
  const s = setup();
  s.context.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
  await s.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('error');
  const resume = deferred<void>();
  s.context.resume.mockReturnValueOnce(resume.promise);
  await s.click('Яңадан');
  expect(screen.getByTestId('state')).toHaveTextContent('preparing');
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.getByTestId('state')).toHaveTextContent('error');
  await s.click('Өйгә');
  await s.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  resume.resolve();
  await s.settle();
  expect(s.learningSources).toHaveLength(1);
  expect(screen.getByTestId('session')).toHaveTextContent('session-2');
});
