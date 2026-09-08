import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { contentV2 } from '../../src/content/v2/catalog.ts';
import { hasHint } from '../../src/domain/game/reducer.ts';
import {
  browserAudio,
  browserImages,
  flush,
  successfulFetch,
  identifyInteractions,
} from './browser.ts';
import {
  useGameSession,
  type GameSessionOptions,
} from '../../src/features/game/use-game-session.ts';

export function Harness({ options }: { options: GameSessionOptions }) {
  const game = useGameSession(options);
  return (
    <>
      <button onClick={() => game.start(contentV2.categories[1]!)}>
        Хайваннар
      </button>
      <button onClick={() => game.exit(true)}>Өйгә</button>
      <button onClick={game.repeat}>Кабатла</button>
      <button onClick={game.retry}>Яңадан</button>
      <button onClick={game.continueGame}>Дәвам ит</button>
      <button onClick={game.activity}>Кагылу</button>
      <button
        onClick={() => game.answer(game.state?.round.correctOptionId ?? '')}
      >
        Җавап
      </button>
      <button
        onClick={() =>
          game.answer(
            game.state?.round.options
              .map((x) => x.id)
              .find((id) => id !== game.state?.round.correctOptionId) ?? '',
          )
        }
      >
        Ялгыш
      </button>
      <output data-testid="hint">
        {game.state && hasHint(game.state) ? 'hint' : 'none'}
      </output>
      <output data-testid="target">
        {game.state?.round.correctOptionId ?? ''}
      </output>
      <output data-testid="options">
        {game.state?.round.options.map((x) => x.id).join(',') ?? ''}
      </output>
      <output data-testid="state">{game.state?.status ?? 'home'}</output>
      <output data-testid="round">{game.state?.round.id ?? 0}</output>
      <output data-testid="session">
        {game.state?.session.sessionId ?? ''}
      </output>
    </>
  );
}

export function setup(autoEndInteractions = true) {
  const audio = browserAudio(autoEndInteractions);
  const images = browserImages();
  const fetch = successfulFetch();
  let nextId = 0;
  const options: GameSessionOptions = {
    audio: { ...audio, fetch: identifyInteractions(fetch) },
    images: { ...images, fetch },
    random: () => 0,
    createSessionId: () => `session-${++nextId}`,
  };
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const view = render(
    <StrictMode>
      <Harness options={options} />
    </StrictMode>,
  );
  const settle = () => act(flush);
  const click = async (name: string) => {
    await user.click(screen.getByRole('button', { name }));
    await settle();
  };
  return { ...audio, ...images, fetch, options, user, view, settle, click };
}
