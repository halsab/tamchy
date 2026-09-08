// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  screen,
  within,
  fireEvent,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import strings from '../content/tt.json';
import data from '../content/catalog.json';
import type { Catalog } from '../content/types.ts';
const catalog = data as Catalog;
import { setupApp } from '../../tests/helpers/app-ui.tsx';
import { deferred } from '../../tests/helpers/browser.ts';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  configure({ asyncWrapper: async (callback) => act(callback) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.useRealTimers();
  window.history.replaceState(null, '', '#/');
});

it('главное меню: название, порядок трёх разделов и информация для взрослых', async () => {
  const s = setupApp();
  expect(screen.getByRole('heading', { name: strings.app.name })).toBeVisible();
  expect(
    screen
      .getAllByRole('button')
      .slice(0, 3)
      .map((button) => button.textContent),
  ).toEqual(['Төсләр', 'Хайваннар', 'Саннар']);
  expect(
    screen.getByRole('button', { name: strings.nav.parents }).textContent,
  ).toBe('');
  expect(screen.getByRole('main').querySelectorAll('img')).toHaveLength(3);
  expect(s.fetch).not.toHaveBeenCalled();
  await s.click(strings.nav.parents);
  expect(location.hash).toBe('#/parents');
  expect(
    screen.getByRole('dialog', { name: strings.nav.parents }),
  ).toBeVisible();
  expect(
    screen.getByRole('heading', { name: strings.nav.parents }),
  ).toBeVisible();
  expect(screen.getByRole('main')).toHaveTextContent('0.1.0');
  expect(
    screen.queryByText(strings.status.offlineReady),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '2–4 яшь' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '5–7 яшь' })).not.toBeChecked();
  await s.click(strings.nav.home);
  expect(location.hash).toBe('#/');
});

it('режим сохраняется, но не меняет текущий набор и два ответа MVP', async () => {
  const s = setupApp();
  await s.click(strings.nav.parents);
  await s.user.click(screen.getByRole('radio', { name: '5–7 яшь' }));
  expect(localStorage.getItem('tamchy.age-mode')).toBe('senior');
  await s.click(strings.nav.home);
  await s.click('Саннар');
  expect(answers()).toHaveLength(2);
  expect(catalog.categories[2]!.items).toHaveLength(5);
  await s.click(strings.nav.home);
  await s.click(strings.nav.parents);
  expect(screen.getByRole('radio', { name: '5–7 яшь' })).toBeChecked();
  s.view.unmount();
  const next = setupApp('#/parents');
  await next.settle();
  expect(screen.getByRole('radio', { name: '5–7 яшь' })).toBeChecked();
});

it('при недоступном хранилище режим переживает переходы в памяти приложения', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  const s = setupApp('#/parents');
  await s.settle();
  await s.user.click(screen.getByRole('radio', { name: '5–7 яшь' }));
  await s.click(strings.nav.home);
  await s.click('Төсләр');
  await s.click(strings.nav.home);
  await s.click(strings.nav.parents);
  expect(screen.getByRole('radio', { name: '5–7 яшь' })).toBeChecked();
});

it.each(catalog.categories)(
  'карточка $id запускает одну сессию из жеста и открывает маршрут',
  async (category) => {
    const s = setupApp();
    s.fetch.mockImplementation(async () => {
      expect(s.context.resume).toHaveBeenCalledTimes(1);
      return new Response('resource');
    });
    await s.click(category.labelTt);
    expect(location.hash).toBe(`#/${category.id}`);
    expect(
      screen.getByRole('heading', { name: category.labelTt }),
    ).toBeVisible();
    expect(s.createSessionId).toHaveBeenCalledTimes(1);
    expect(s.learningSources).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: strings.action.listen }),
    ).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    await s.settle();
    expect(s.createSessionId).toHaveBeenCalledTimes(1);
    await s.click(strings.nav.home);
    expect(s.learningSources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#/');
  },
);

it('прямой вход и повторный mount ждут активации, StrictMode не дублирует старт', async () => {
  const s = setupApp('#/animals');
  await s.settle();
  expect(s.createSessionId).toHaveBeenCalledTimes(1);
  expect(s.createContext).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: strings.action.listen }),
  ).toBeVisible();
  await s.click(strings.action.listen);
  expect(s.learningSources).toHaveLength(1);
  expect(s.createSessionId).toHaveBeenCalledTimes(1);
  s.view.unmount();
  const next = setupApp('#/animals');
  await next.settle();
  expect(next.createContext).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: strings.action.listen }),
  ).toBeVisible();
  await next.click(strings.nav.home);
  expect(location.hash).toBe('#/');
});

it('неизвестный адрес заменяется главным без новой записи истории', async () => {
  const s = setupApp('#/unknown');
  const length = history.length;
  await s.settle();
  expect(location.hash).toBe('#/');
  expect(history.length).toBe(length);
  expect(screen.getByRole('heading', { name: strings.app.name })).toBeVisible();
});

it('до начала аудио ответы заблокированы; отказ загрузки оставляет повтор и домик', async () => {
  const s = setupApp();
  const network = deferred<Response>();
  s.fetch.mockReturnValue(network.promise);
  await s.click('Хайваннар');
  const answers = within(
    screen.getByRole('group', { name: strings.game.answers }),
  ).getAllByRole('button');
  answers.forEach((button) => expect(button).toBeDisabled());
  expect(screen.getByRole('button', { name: strings.nav.home })).toBeEnabled();
  network.resolve(new Response(null, { status: 404 }));
  await s.settle();
  expect(screen.getByRole('alert')).toHaveTextContent(strings.error.load);
  expect(screen.getByRole('alert')).not.toHaveTextContent('assets/');
  s.fetch.mockImplementation(async () => new Response('resource'));
  await s.click(strings.action.retry);
  answers.forEach((button) => expect(button).toBeEnabled());
});

it('ошибка отображённой картинки блокирует ответы, сохраняет раунд и восстанавливает ресурс', async () => {
  const s = setupApp();
  await s.click('Хайваннар');
  const group = screen.getByRole('group', { name: strings.game.answers });
  const answers = within(group).getAllByRole('button');
  const displayed = group.querySelector('img')!;
  const oldSource = s.learningSources[0]!;
  fireEvent.error(displayed);
  await s.settle();
  expect(screen.getByRole('alert')).toHaveTextContent(strings.error.load);
  answers.forEach((button) => expect(button).toBeDisabled());
  expect(oldSource.stop).toHaveBeenCalledTimes(1);
  const before = s.fetch.mock.calls.length;
  await s.click(strings.action.retry);
  expect(s.fetch.mock.calls.length).toBeGreaterThan(before);
  expect(within(group).getAllByRole('button')).toEqual(answers);
  answers.forEach((button) => expect(button).toBeEnabled());
});

function answers() {
  return within(
    screen.getByRole('group', { name: strings.game.answers }),
  ).getAllByRole('button');
}
function target() {
  return catalog.categories
    .flatMap((category) => category.items)
    .find((item) => screen.queryByText(item.promptTt))!;
}

it('ошибки и повтор сохраняют карточки; две ошибки показывают подсказку, верный ответ — знак', async () => {
  const s = setupApp();
  await s.click('Хайваннар');
  const original = answers();
  const item = target();
  const wrong = original.find(
    (button) => button.getAttribute('aria-label') !== item.labelTt,
  )!;
  for (let attempt = 0; attempt < 2; attempt++) {
    await s.user.click(wrong);
    await s.settle();
    expect(screen.getByRole('status')).toHaveTextContent(strings.game.tryAgain);
    original.forEach((button) => expect(button).toBeDisabled());
    await act(() => vi.advanceTimersByTimeAsync(250));
    await s.settle();
    expect(answers()).toEqual(original);
  }
  const right = screen.getByRole('button', { name: item.labelTt });
  expect(right).toHaveAccessibleDescription(strings.game.hint);
  const oldAudio = s.learningSources.at(-1)!;
  await s.click(strings.action.listenAgain);
  expect(oldAudio.stop).toHaveBeenCalledTimes(1);
  expect(answers()).toEqual(original);
  const historyLength = history.length;
  await s.user.dblClick(right);
  await s.settle();
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  expect(
    screen.getByRole('button', { name: strings.action.listenAgain }),
  ).toBeDisabled();
  original.forEach((button) => expect(button).toBeDisabled());
  act(() => s.learningSources.at(-1)!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(1200));
  await s.settle();
  expect(target().id).not.toBe(item.id);
  expect(location.hash).toBe('#/animals');
  expect(history.length).toBe(historyLength);
  expect(s.createSessionId).toHaveBeenCalledTimes(1);
});

it('все числа 1–5 содержат точное количество яблок и цифру текстом', async () => {
  const s = setupApp();
  await s.click('Саннар');
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const item = target();
    seen.add(item.id);
    for (const button of answers()) {
      const number = catalog.categories[2]!.items.find(
        (item) => item.labelTt === button.getAttribute('aria-label'),
      )!;
      if (!('value' in number)) throw new Error('Ожидается число');
      expect(button).toHaveTextContent(String(number.value));
      expect(button.querySelectorAll('img')).toHaveLength(number.value!);
      for (const image of button.querySelectorAll('img'))
        expect(image).toHaveAttribute('width', '768');
    }
    await s.click(item.labelTt);
    act(() => s.learningSources.at(-1)!.onended!());
    await act(() => vi.advanceTimersByTimeAsync(1200));
    await s.settle();
  }
  expect(seen.size).toBe(5);
});

it('цвета имеют одинаковую форму с точными учебными значениями', async () => {
  const s = setupApp();
  await s.click('Төсләр');
  for (const button of answers()) {
    const item = catalog.categories[0]!.items.find(
      (item) => item.labelTt === button.getAttribute('aria-label'),
    )!;
    expect(button.querySelector('img')).toBeNull();
    if (item.kind !== 'color') throw new Error('Ожидается цвет');
    expect(button.firstElementChild).toHaveStyle({ backgroundColor: item.hex });
  }
});

it('пауза оставляет карточки и домик; продолжение до ответа повторяет прежнее задание', async () => {
  const s = setupApp();
  await s.click('Хайваннар');
  const original = answers();
  const item = target();
  act(() => s.changeState('interrupted'));
  original.forEach((button) => expect(button).toBeDisabled());
  expect(screen.getByRole('button', { name: strings.nav.home })).toBeEnabled();
  await s.click(strings.action.continue);
  expect(answers()).toEqual(original);
  expect(target()).toBe(item);
  await s.click(item.labelTt);
  act(() => s.changeState('interrupted'));
  await s.click(strings.action.continue);
  expect(target().id).not.toBe(item.id);
});

it('ошибка подтверждения не отменяет ответ; явный повтор восстанавливает озвучку', async () => {
  const s = setupApp();
  await s.click('Төсләр');
  const item = target();
  s.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await s.click(item.labelTt);
  expect(screen.getByRole('alert')).toHaveTextContent(strings.error.audio);
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  await s.click(strings.action.retry);
  act(() => s.learningSources.at(-1)!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(1200));
  await s.settle();
  expect(target().id).not.toBe(item.id);
});

it('запрет воспроизведения восстанавливается крупной кнопкой активации', async () => {
  const s = setupApp();
  s.context.resume.mockImplementationOnce(async () => {});
  await s.click('Төсләр');
  answers().forEach((button) => expect(button).toBeDisabled());
  await s.click(strings.action.listen);
  answers().forEach((button) => expect(button).toBeEnabled());
});

it('активность за пределами игровых кнопок снимает напоминание', async () => {
  const s = setupApp();
  await s.click('Төсләр');
  act(() => s.learningSources.at(-1)!.onended!());
  await s.settle();
  fireEvent.pointerDown(screen.getByRole('main'));
  await act(() => vi.advanceTimersByTimeAsync(10000));
  await s.settle();
  expect(s.learningSources).toHaveLength(1);
});

it('Tab, Enter и Space управляют настоящими кнопками', async () => {
  const s = setupApp();
  await s.settle();
  await s.user.tab();
  expect(screen.getByRole('button', { name: 'Төсләр' })).toHaveFocus();
  await s.user.keyboard('{Enter}');
  await s.settle();
  expect(location.hash).toBe('#/colors');
  await s.user.tab();
  expect(screen.getByRole('button', { name: strings.nav.home })).toHaveFocus();
  await s.user.keyboard(' ');
  await s.settle();
  expect(location.hash).toBe('#/');
});

it('сбой яблока после правильного ответа восстанавливает картинку и подтверждение без второго зачёта', async () => {
  const s = setupApp();
  await s.click('Саннар');
  const item = target();
  await s.click(item.labelTt);
  fireEvent.error(
    screen
      .getByRole('group', { name: strings.game.answers })
      .querySelector('img')!,
  );
  await s.settle();
  expect(screen.getByRole('alert')).toHaveTextContent(strings.error.load);
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  await s.click(strings.action.retry);
  expect(screen.getByRole('img', { name: strings.game.correct })).toBeVisible();
  act(() => s.learningSources.at(-1)!.onended!());
  await act(() => vi.advanceTimersByTimeAsync(1200));
  await s.settle();
  expect(target().id).not.toBe(item.id);
  expect(s.createSessionId).toHaveBeenCalledTimes(1);
});

it.each(['preparing', 'correct', 'retrying', 'paused', 'error'])(
  'домик доступен в фазе %s и прекращает её работу',
  async (phase) => {
    const s = setupApp();
    if (phase === 'preparing')
      s.fetch.mockReturnValue(deferred<Response>().promise);
    if (phase === 'error')
      s.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await s.click('Төсләр');
    if (phase === 'correct') await s.click(target().labelTt);
    if (phase === 'retrying')
      await s.user.click(
        answers().find(
          (button) => button.getAttribute('aria-label') !== target().labelTt,
        )!,
      );
    if (phase === 'paused') act(() => s.changeState('interrupted'));
    await s.click(strings.nav.home);
    expect(
      screen.getByRole('heading', { name: strings.app.name }),
    ).toBeVisible();
    const sources = s.learningSources.length;
    await act(() => vi.advanceTimersByTimeAsync(20000));
    await s.settle();
    expect(s.learningSources).toHaveLength(sources);
    expect(location.hash).toBe('#/');
  },
);
