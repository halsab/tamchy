// @vitest-environment jsdom
import { Activity, StrictMode } from 'react';
import {
  act,
  cleanup,
  configure,
  screen,
  render,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/helpers/browser.ts';
import { Harness, setup } from '../../../tests/helpers/session-ui.tsx';

beforeEach(() => {
  vi.useFakeTimers();
  // RTL 16 проверяет только Jest при сливе очереди; управление временем здесь принадлежит Vitest.
  configure({ asyncWrapper: async (callback) => act(callback) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('StrictMode не запускает сессию при рендере; действие активирует звук до сети', async () => {
  const s = setup();
  expect(s.createContext).not.toHaveBeenCalled();
  expect(s.fetch).not.toHaveBeenCalled();
  s.fetch.mockImplementation(async () => {
    expect(s.context.resume).toHaveBeenCalledTimes(1);
    return new Response('resource');
  });
  await s.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(s.createContext).toHaveBeenCalledTimes(1);
  expect(s.learningSources).toHaveLength(1);
  s.view.rerender(
    <StrictMode>
      <Harness options={s.options} />
    </StrictMode>,
  );
  expect(s.learningSources[0]!.stop).not.toHaveBeenCalled();
});

it('выход отменяет pending fetch; повторный вход получает новую сессию, поздний результат игнорируется', async () => {
  const s = setup();
  const network = deferred<Response>();
  s.fetch.mockReturnValueOnce(network.promise);
  await s.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('preparing');
  await s.click('Өйгә');
  expect(screen.getByTestId('state')).toHaveTextContent('ended');
  expect(s.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await s.click('Хайваннар');
  expect(screen.getByTestId('session')).toHaveTextContent('session-2');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  network.resolve(new Response('late'));
  await s.settle();
  expect(s.learningSources).toHaveLength(1);
  expect(screen.getByTestId('round')).toHaveTextContent('1');
});

it('скрытие немедленно останавливает звук, возврат ждёт явного продолжения', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const oldEnd = s.learningSources[0]!.onended!;
  act(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.learningSources[0]!.stop).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  act(() => {
    oldEnd();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await s.settle();
  expect(s.learningSources).toHaveLength(1);
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  await s.click('Дәвам ит');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(s.learningSources).toHaveLength(2);
});

it('системное прерывание после ответа продолжает одним следующим раундом', async () => {
  const s = setup();
  await s.click('Хайваннар');
  await s.click('Җавап');
  expect(screen.getByTestId('state')).toHaveTextContent('correct');
  act(() => s.changeState('interrupted'));
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  await s.click('Дәвам ит');
  await act(() => vi.advanceTimersByTimeAsync(0));
  await s.settle();
  expect(screen.getByTestId('round')).toHaveTextContent('2');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
});

it('unmount снимает подписки и отменяет decode; новый mount пригоден для запуска', async () => {
  const s = setup();
  const decoding = deferred<AudioBuffer>();
  s.context.decodeAudioData.mockReturnValueOnce(decoding.promise);
  await s.click('Хайваннар');
  s.view.unmount();
  expect(s.listeners.size).toBe(0);
  expect(s.context.close).toHaveBeenCalledTimes(1);
  decoding.resolve({ length: 100, numberOfChannels: 1 } as AudioBuffer);
  await s.settle();
  expect(s.sources).toHaveLength(0);
  const next = setup();
  await next.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(next.learningSources).toHaveLength(1);
});

it('домик завершает сессию и после ответа в том же пакете React-событий', async () => {
  const s = setup();
  await s.click('Хайваннар');
  act(() => {
    screen.getByRole('button', { name: 'Җавап' }).click();
    screen.getByRole('button', { name: 'Өйгә' }).click();
    expect(s.learningSources[0]!.onended).toBeNull();
  });
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('ended');
  expect(s.learningSources).toHaveLength(1);
});

it('новый объект options сохраняет владельца, раунд и воспроизведение', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const target = screen.getByTestId('target').textContent!;
  const late = s.learningSources[0]!.onended!;
  const restored = { ...s.options };
  s.view.rerender(
    <StrictMode>
      <Harness options={restored} />
    </StrictMode>,
  );
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(s.listeners.size).toBe(1);
  expect(s.context.close).not.toHaveBeenCalled();
  expect(s.learningSources[0]!.stop).not.toHaveBeenCalled();
  act(late);
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(screen.getByTestId('target')).toHaveTextContent(target);
  expect(s.learningSources).toHaveLength(1);
});

it('React Activity выполняет полный cleanup/setup активной сессии и ждёт продолжения', async () => {
  const s = setup();
  s.view.unmount();
  const tree = (mode: 'visible' | 'hidden') => (
    <StrictMode>
      <Activity mode={mode}>
        <Harness options={s.options} />
      </Activity>
    </StrictMode>
  );
  const view = render(tree('visible'));
  await s.click('Хайваннар');
  const target = screen.getByTestId('target').textContent;
  const late = s.learningSources[0]!.onended!;
  view.rerender(tree('hidden'));
  expect(s.context.close).toHaveBeenCalledTimes(1);
  expect(s.listeners.size).toBe(0);
  view.rerender(tree('visible'));
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  act(late);
  await s.click('Дәвам ит');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(screen.getByTestId('target')).toHaveTextContent(target!);
  expect(s.learningSources).toHaveLength(2);
});

it('приветствие не разрешает ответ; повтор отменяет его и запускает только задание', async () => {
  const s = setup(false);
  await s.click('Хайваннар');
  expect(screen.getByTestId('state')).toHaveTextContent('preparing');
  expect(s.fetch.mock.calls.at(-1)?.[0]).toContain('/interaction/hello.mp3');
  const lateEnd = s.sources[0]!.onended!;
  await s.click('Җавап');
  expect(screen.getByTestId('state')).toHaveTextContent('preparing');
  await s.click('Кабатла');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(s.sources[0]!.onended).toBeNull();
  act(lateEnd);
  await s.settle();
  expect(s.learningSources).toHaveLength(1);
  expect(s.sources).toHaveLength(2);
});

it('похвала предшествует названию, оба тайминга считаются до нового раунда', async () => {
  const s = setup(false);
  await s.click('Хайваннар');
  act(() => s.sources.at(-1)!.onended!());
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  await s.click('Җавап');
  expect(s.fetch.mock.calls.at(-1)?.[0]).toContain('/interaction/correct.mp3');
  expect(screen.getByTestId('state')).toHaveTextContent('correct');
  await act(() => vi.advanceTimersByTimeAsync(1200));
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  const latePraiseEnd = s.sources.at(-1)!.onended!;
  act(latePraiseEnd);
  await s.settle();
  expect(s.learningSources).toHaveLength(2);
  act(latePraiseEnd);
  await s.settle();
  expect(s.learningSources).toHaveLength(2);
  act(() => s.sources.at(-1)!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  await act(() => vi.advanceTimersByTimeAsync(1));
  await s.settle();
  expect(screen.getByTestId('round')).toHaveTextContent('2');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
});

it('пауза в приветствии ждёт касания, продолжает тот же раунд с репликой и заданием', async () => {
  const s = setup(false);
  await s.click('Хайваннар');
  const target = screen.getByTestId('target').textContent;
  const lateEnd = s.sources[0]!.onended!;
  act(() => s.changeState('interrupted'));
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  act(lateEnd);
  await s.settle();
  expect(s.sources).toHaveLength(1);
  await s.click('Дәвам ит');
  expect(s.fetch.mock.calls.at(-1)?.[0]).toContain('/interaction/continue.mp3');
  expect(screen.getByTestId('state')).toHaveTextContent('preparing');
  act(() => s.sources.at(-1)!.onended!());
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('target')).toHaveTextContent(target!);
});

it('домик сразу завершает игру; прощание отменяется новым входом и скрытием', async () => {
  const s = setup(false);
  await s.click('Хайваннар');
  await s.click('Өйгә');
  expect(screen.getByTestId('state')).toHaveTextContent('ended');
  expect(s.fetch.mock.calls.at(-1)?.[0]).toContain('/interaction/goodbye.mp3');
  const goodbye = s.sources.at(-1)!;
  const lateEnd = goodbye.onended!;
  await s.click('Хайваннар');
  expect(goodbye.stop).toHaveBeenCalledTimes(1);
  expect(s.fetch.mock.calls.at(-1)?.[0]).toContain(
    '/interaction/game-start.mp3',
  );
  act(lateEnd);
  await s.settle();
  expect(s.sources.at(-1)!.onended).not.toBeNull();
  await s.click('Өйгә');
  act(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(s.sources.at(-1)!.onended).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
