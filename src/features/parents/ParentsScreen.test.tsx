// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import strings from '../../content/tt.json';
import { ParentsScreen } from './ParentsScreen.tsx';
import type { PwaState } from '../../services/pwa/service.ts';
import { mockDialog } from '../../../tests/helpers/dialog.ts';
beforeEach(mockDialog);
afterEach(cleanup);
it.each(['preparing', 'ready', 'error', 'unsupported'] as const)(
  'показывает настоящее состояние %s и только доступные действия',
  async (offline) => {
    const retry = vi.fn();
    const install = vi.fn();
    render(
      <ParentsScreen
        open
        onClosed={vi.fn()}
        mode="junior"
        onModeChange={vi.fn()}
        onHome={vi.fn()}
        version="0.1.0 · a"
        pwa={{ offline, update: 'none', install: 'unavailable' }}
        onRetry={retry}
        onInstall={install}
      />,
    );
    expect(
      screen.getByRole('status', { name: strings.parents.connectionTitle }),
    ).toHaveTextContent(
      offline === 'ready' ? strings.status.offlineReady : strings.pwa[offline],
    );
    expect(
      screen.queryByRole('button', { name: strings.pwa.installAction }),
    ).not.toBeInTheDocument();
    if (offline === 'error') {
      await userEvent.click(
        screen.getByRole('button', { name: strings.action.retry }),
      );
      expect(retry).toHaveBeenCalledOnce();
    } else
      expect(
        screen.queryByRole('button', { name: strings.action.retry }),
      ).not.toBeInTheDocument();
    expect(screen.getByText(strings.pwa.ios)).toBeVisible();
    expect(screen.getByText(strings.pwa.android)).toBeVisible();
  },
);
it('обновление независимо от готовности; установка только по явному нажатию', async () => {
  const install = vi.fn();
  const pwa: PwaState = {
    offline: 'ready',
    update: 'waiting',
    install: 'available',
  };
  render(
    <ParentsScreen
      open
      onClosed={vi.fn()}
      mode="junior"
      onModeChange={vi.fn()}
      onHome={vi.fn()}
      version="a"
      pwa={pwa}
      onRetry={vi.fn()}
      onInstall={install}
    />,
  );
  expect(screen.getByText(strings.status.offlineReady)).toBeVisible();
  expect(screen.getByText(strings.pwa.updateWaiting)).toBeVisible();
  expect(install).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: strings.pwa.installAction }),
  );
  expect(install).toHaveBeenCalledOnce();
});

it('закрывает крестиком и начинает повторное открытие с начала текста', async () => {
  const close = vi.fn();
  const props = {
    onHome: close,
    onClosed: vi.fn(),
    mode: 'junior' as const,
    onModeChange: vi.fn(),
    version: 'test',
    pwa: {
      offline: 'ready',
      update: 'none',
      install: 'unavailable',
    } as PwaState,
    onRetry: vi.fn(),
    onInstall: vi.fn(),
  };
  const view = render(<ParentsScreen {...props} open />);
  expect(screen.queryByRole('button', { name: strings.nav.home })).toBeNull();
  const body = screen
    .getByText(strings.parents.settingsTitle)
    .closest('section')!.parentElement!;
  body.scrollTop = 700;
  await userEvent.click(screen.getByRole('button', { name: 'Ябу' }));
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<ParentsScreen {...props} open={false} />);
  view.rerender(<ParentsScreen {...props} open />);
  expect(body.scrollTop).toBe(0);
});
