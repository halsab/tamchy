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
  expect(s.sources).toHaveLength(1);
  s.view.rerender(
    <StrictMode>
      <Harness options={s.options} />
    </StrictMode>,
  );
  expect(s.sources[0]!.stop).not.toHaveBeenCalled();
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
  expect(s.sources).toHaveLength(1);
  expect(screen.getByTestId('round')).toHaveTextContent('1');
});

it('скрытие немедленно останавливает звук, возврат ждёт явного продолжения', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const oldEnd = s.sources[0]!.onended!;
  act(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.sources[0]!.stop).toHaveBeenCalledTimes(1);
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
  expect(s.sources).toHaveLength(1);
  expect(screen.getByTestId('state')).toHaveTextContent('paused');
  await s.click('Дәвам ит');
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(s.sources).toHaveLength(2);
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
  expect(next.sources).toHaveLength(1);
});

it('домик завершает сессию и после ответа в том же пакете React-событий', async () => {
  const s = setup();
  await s.click('Хайваннар');
  act(() => {
    screen.getByRole('button', { name: 'Җавап' }).click();
    screen.getByRole('button', { name: 'Өйгә' }).click();
    expect(s.sources[0]!.onended).toBeNull();
  });
  await s.settle();
  expect(screen.getByTestId('state')).toHaveTextContent('ended');
  expect(s.sources).toHaveLength(1);
});

it('новый объект options сохраняет владельца, раунд и воспроизведение', async () => {
  const s = setup();
  await s.click('Хайваннар');
  const target = screen.getByTestId('target').textContent!;
  const late = s.sources[0]!.onended!;
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
  expect(s.sources[0]!.stop).not.toHaveBeenCalled();
  act(late);
  expect(screen.getByTestId('state')).toHaveTextContent('awaiting');
  expect(screen.getByTestId('round')).toHaveTextContent('1');
  expect(screen.getByTestId('target')).toHaveTextContent(target);
  expect(s.sources).toHaveLength(1);
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
  const late = s.sources[0]!.onended!;
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
  expect(s.sources).toHaveLength(2);
});
