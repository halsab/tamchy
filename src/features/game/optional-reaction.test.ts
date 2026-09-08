import { afterEach, expect, it, vi } from 'vitest';
import { createGameExecutor } from './executor.ts';
import { createAudioService } from '../../services/audio/audio.ts';
import { createImageService } from '../../services/assets/images.ts';
import { createTintedImageService } from '../../services/assets/tinted-images.ts';
import { createSessionRounds } from './session-rounds.ts';
import { gameCategories } from '../../../tests/helpers/game-content.ts';
import {
  browserAudio,
  browserImages,
  successfulFetch,
} from '../../../tests/helpers/browser.ts';
import type { GameEvent } from '../../domain/game/models.ts';

function setup() {
  vi.useFakeTimers();
  const audio = createAudioService({
    ...browserAudio(true),
    fetch: successfulFetch(),
  });
  const play = vi.spyOn(audio, 'play').mockImplementation(() => {});
  const images = createImageService({
    ...browserImages(),
    fetch: successfulFetch(),
  });
  const tintedImages = createTintedImageService({
    fetch: successfulFetch(),
    processor: { run: vi.fn(), dispose: vi.fn() },
  });
  const events: GameEvent[] = [];
  const executor = createGameExecutor({
    audio,
    images,
    tintedImages,
    rounds: createSessionRounds('s', gameCategories[0]!, () => 0),
    clock: {
      now: () => performance.now(),
      setTimeout: (f, d) => setTimeout(f, d),
      clearTimeout: (id) => clearTimeout(id),
    },
    send: (event) => events.push(event),
  });
  executor.reconcile({
    scope: { sessionId: 's', roundId: 1, operationId: 1 },
    work: {
      kind: 'play',
      resource: {
        kind: 'confirmation',
        path: 'assets/audio/tt/interaction/correct.mp3',
      },
      sequence: ['assets/audio/tt/interaction/correct.mp3'],
      optional: true,
      started: false,
      introduction: null,
      timeoutAt: performance.now() + 2000,
    },
  });
  return { executor, events, callbacks: play.mock.calls[0]![2] };
}
afterEach(() => vi.useRealTimers());
it.each(['load', 'decode'] as const)(
  'ошибка необязательной похвалы %s завершает только реакцию',
  (reason) => {
    const s = setup();
    s.callbacks.failed(reason);
    expect(s.events.at(-1)?.type).toBe('REACTION_SKIPPED');
    s.executor.dispose();
  },
);
it('необязательная похвала ограничена двумя секундами и отменяется', () => {
  const s = setup();
  vi.advanceTimersByTime(1999);
  expect(s.events).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(s.events.at(-1)?.type).toBe('REACTION_SKIPPED');
  s.executor.dispose();
  s.callbacks.ended();
  expect(s.events).toHaveLength(1);
});
it('запрет звука остаётся восстановимой ошибкой', () => {
  const s = setup();
  s.callbacks.failed('blocked');
  expect(s.events.at(-1)).toMatchObject({
    type: 'RESOURCE_FAILED',
    reason: 'blocked',
  });
  s.executor.dispose();
});
