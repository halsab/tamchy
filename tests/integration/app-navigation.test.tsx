// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, configure, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App.tsx';
import strings from '../../src/content/tt.json';
import { setupApp } from '../helpers/app-ui.tsx';
import { deferred } from '../helpers/browser.ts';

beforeEach(() => {
  vi.useFakeTimers();
  configure({ asyncWrapper: async (callback) => act(callback) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '#/');
});

it('сессия останавливается при переходе к взрослым и другому разделу; поздние запросы игнорируются', async () => {
  const s = setupApp();
  const network = deferred<Response>();
  s.fetch.mockReturnValueOnce(network.promise);
  await s.click('Хайваннар');
  await s.route('#/parents');
  expect(s.fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  network.resolve(new Response('late'));
  await s.settle();
  expect(s.sources).toHaveLength(0);
  await s.route('#/numbers');
  expect(
    screen.getByRole('button', { name: strings.action.listen }),
  ).toBeVisible();
  await s.click(strings.action.listen);
  const previous = s.sources[0]!;
  await s.route('#/colors');
  expect(previous.stop).toHaveBeenCalledTimes(1);
  expect(s.createSessionId).toHaveBeenCalledTimes(3);
  await s.click(strings.nav.home);
});

it('быстрые старт, выход и новая категория согласуются даже в одном пакете React', async () => {
  const s = setupApp();
  await s.settle();
  act(() => {
    screen.getByRole('button', { name: 'Хайваннар' }).click();
    history.pushState(null, '', '#/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    screen.getByRole('button', { name: 'Саннар' }).click();
  });
  await s.settle();
  expect(location.hash).toBe('#/numbers');
  expect(screen.getByRole('heading', { name: 'Саннар' })).toBeVisible();
  expect(s.sources).toHaveLength(1);
  expect(s.createSessionId).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await s.settle();
  expect(s.createSessionId).toHaveBeenCalledTimes(2);
});

it('новые options и повторные события истории не пересоздают сессию или адаптеры', async () => {
  const s = setupApp();
  await s.click('Төсләр');
  s.view.rerender(
    <StrictMode>
      <App options={{ ...s.options }} />
    </StrictMode>,
  );
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await s.settle();
  expect(s.createSessionId).toHaveBeenCalledTimes(1);
  expect(s.sources).toHaveLength(1);
  expect(s.context.close).not.toHaveBeenCalled();
  expect(s.sources[0]!.stop).not.toHaveBeenCalled();
});
