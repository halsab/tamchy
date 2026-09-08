import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../../src/app/App.tsx';
import { mockDialog } from './dialog.ts';
import {
  browserAudio,
  browserImages,
  flush,
  successfulFetch,
  identifyInteractions,
} from './browser.ts';

export function setupApp(hash = '#/', autoEndInteractions = true) {
  mockDialog();
  window.history.replaceState(null, '', hash);
  const audio = browserAudio(autoEndInteractions);
  const images = browserImages();
  const fetch = successfulFetch();
  const createSessionId = vi.fn(() => crypto.randomUUID());
  const options = {
    audio: { ...audio, fetch: identifyInteractions(fetch) },
    images: { ...images, fetch },
    random: () => 0,
    createSessionId,
  };
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const view = render(
    <StrictMode>
      <App options={options} />
    </StrictMode>,
  );
  const settle = () => act(flush);
  const click = async (name: string) => {
    await user.click(screen.getByRole('button', { name }));
    await settle();
  };
  const route = async (hash: string) => {
    act(() => {
      window.history.pushState(null, '', hash);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await settle();
  };
  return {
    ...audio,
    ...images,
    options,
    fetch,
    createSessionId,
    user,
    view,
    settle,
    click,
    route,
  };
}
