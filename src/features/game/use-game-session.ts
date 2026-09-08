import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  GameEvent,
  GameEventData,
  GameState,
} from '../../domain/game/models.ts';
import { createGame, gameReducer } from '../../domain/game/reducer.ts';
import { contentV2 } from '../../content/v2/catalog.ts';
import type { CategoryDefinition, ContentV2 } from '../../content/v2/types.ts';
import {
  createTintedImageService,
  type TintBoundary,
  type TintedImageService,
} from '../../services/assets/tinted-images.ts';
import { assetUrl } from '../../services/assets/asset-url.ts';
import { audioResource } from '../../domain/game/resources.ts';
import { getGameRequirements } from '../../domain/game/requirements.ts';
import {
  createAudioService,
  type AudioBoundary,
  type AudioService,
} from '../../services/audio/audio.ts';
import {
  createImageService,
  type ImageBoundary,
  type ImageService,
} from '../../services/assets/images.ts';
import {
  browserClock,
  createGameExecutor,
  type GameClock,
  type GameExecutor,
} from './executor.ts';
import { createSessionRounds, type SessionRounds } from './session-rounds.ts';
import { interactionPath } from '../../content/interactions.ts';

export type GameSessionOptions = {
  audio?: Partial<AudioBoundary>;
  images?: Partial<ImageBoundary>;
  tintedImages?: Partial<TintBoundary>;
  content?: ContentV2;
  clock?: GameClock;
  random?: () => number;
  createSessionId?: () => string;
  visibility?: {
    hidden: () => boolean;
    subscribe: (listener: () => void) => () => void;
  };
};
const defaultOptions: GameSessionOptions = {};
const browserVisibility = {
  hidden: () => document.hidden,
  subscribe(listener: () => void) {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

type SessionAction =
  | GameEvent
  | { type: 'START'; initial: GameState }
  | { type: 'CONTROL'; sessionId: string; event: 'PAUSE' | 'RETURN' | 'EXIT' };

function sessionReducer(
  state: GameState | null,
  action: SessionAction,
): GameState | null {
  if (action.type === 'START') return action.initial;
  if (!state) return state;
  if (action.type === 'CONTROL') {
    if (action.sessionId !== state.session.sessionId) return state;
    // Команды жизненного цикла сессии действуют и после перехода, поставленного React в очередь тем же нажатием.
    return gameReducer(state, {
      ...getGameRequirements(state).scope,
      type: action.event,
    });
  }
  return gameReducer(state, action);
}

type Owner = {
  audio: AudioService;
  images: ImageService;
  tintedImages: TintedImageService;
  executor: GameExecutor | null;
  restoring: boolean;
  farewell: AbortController | null;
  farewellTimer: ReturnType<typeof setTimeout> | null;
};

function stopFarewell(owner: Owner, clock: GameClock) {
  owner.farewell?.abort();
  owner.farewell = null;
  if (owner.farewellTimer !== null) clock.clearTimeout(owner.farewellTimer);
  owner.farewellTimer = null;
}

export function useGameSession(
  configuration: GameSessionOptions = defaultOptions,
) {
  // Конфигурация задаёт границы владельца при mount, а не при каждом рендере.
  const [options] = useState(() => configuration);
  const [state, dispatch] = useReducer(sessionReducer, null);
  const ownerRef = useRef<Owner | null>(null);
  const roundsRef = useRef<SessionRounds | null>(null);
  const greetedRef = useRef(false);
  const clock = options.clock ?? browserClock;

  useLayoutEffect(() => {
    const owner: Owner = {
      audio: createAudioService(options.audio),
      images: createImageService(options.images),
      tintedImages: createTintedImageService(options.tintedImages),
      executor: null,
      restoring: roundsRef.current !== null,
      farewell: null,
      farewellTimer: null,
    };
    ownerRef.current = owner;
    let attached = true;
    const visibility = options.visibility ?? browserVisibility;
    function notify(event: 'PAUSE' | 'RETURN') {
      if (event === 'PAUSE') stopFarewell(owner, clock);
      const rounds = roundsRef.current;
      if (!attached || !rounds) return;
      if (event === 'PAUSE') owner.executor?.cancel();
      dispatch({ type: 'CONTROL', sessionId: rounds.sessionId, event });
    }
    const removeVisibility = visibility.subscribe(() =>
      notify(visibility.hidden() ? 'PAUSE' : 'RETURN'),
    );
    const removeInterruption = owner.audio.subscribeInterruption(() =>
      notify('PAUSE'),
    );
    if (owner.restoring || visibility.hidden()) notify('PAUSE');
    return () => {
      attached = false;
      removeVisibility();
      removeInterruption();
      owner.executor?.dispose();
      stopFarewell(owner, clock);
      owner.audio.dispose();
      owner.images.dispose();
      owner.tintedImages.dispose();
      ownerRef.current = null;
    };
  }, [options, clock]);

  useLayoutEffect(() => {
    const owner = ownerRef.current;
    const rounds = roundsRef.current;
    if (!owner || !state || !rounds) return;
    if (owner.restoring) {
      if (state.status !== 'paused' && state.status !== 'ended') return;
      owner.restoring = false;
    }
    if (!owner.executor)
      owner.executor = createGameExecutor({
        ...owner,
        clock,
        rounds,
        send: dispatch,
      });
    const phase = state.status === 'paused' ? state.resume : state;
    if (phase.status === 'error') {
      const resource = phase.failure.resource;
      if (resource.kind === 'image') owner.images.invalidate(resource.path);
      if (resource.kind === 'tinted-image')
        owner.tintedImages.invalidate(resource.path, resource.hex);
    }
    owner.executor.reconcile(getGameRequirements(state));
  }, [state, clock, options]);

  const start = useCallback(
    (category: CategoryDefinition, activateAudio = true) => {
      const owner = ownerRef.current;
      if (!owner) return;
      stopFarewell(owner, clock);
      owner.executor?.dispose();
      owner.executor = null;
      owner.restoring = false;
      if (activateAudio) void owner.audio.activate();
      const sessionId = options.createSessionId?.() ?? crypto.randomUUID();
      const definition = {
        id: category.id,
        content: options.content ?? contentV2,
      };
      const rounds = createSessionRounds(
        sessionId,
        definition,
        options.random ?? Math.random,
      );
      roundsRef.current = rounds;
      const initial = createGame(
        sessionId,
        definition,
        rounds.get(1),
        clock.now(),
        greetedRef.current ? 'game-start' : 'hello',
      );
      greetedRef.current = true;
      const prepared = activateAudio
        ? initial
        : gameReducer(initial, {
            ...getGameRequirements(initial).scope,
            type: 'RESOURCE_FAILED',
            resource: audioResource(initial.session, initial.round, 'prompt'),
            reason: 'blocked',
          });
      dispatch({ type: 'START', initial: prepared });
      if ((options.visibility ?? browserVisibility).hidden())
        dispatch({ type: 'CONTROL', sessionId, event: 'PAUSE' });
    },
    [options, clock],
  );

  const exit = useCallback(
    (sayGoodbye = false) => {
      const owner = ownerRef.current;
      if (owner) stopFarewell(owner, clock);
      const rounds = roundsRef.current;
      if (!rounds) return;
      owner?.executor?.dispose();
      if (owner) owner.executor = null;
      roundsRef.current = null;
      dispatch({ type: 'CONTROL', sessionId: rounds.sessionId, event: 'EXIT' });
      if (
        sayGoodbye &&
        owner &&
        !(options.visibility ?? browserVisibility).hidden()
      ) {
        const controller = new AbortController();
        owner.farewell = controller;
        const finish = () => stopFarewell(owner, clock);
        owner.farewellTimer = clock.setTimeout(finish, 15000);
        owner.audio.play(interactionPath('goodbye'), controller.signal, {
          started: () => {},
          ended: finish,
          failed: finish,
        });
      }
    },
    [clock, options],
  );

  function activity() {
    if (!state || state.session.sessionId !== roundsRef.current?.sessionId)
      return;
    ownerRef.current?.executor?.activity();
    dispatch({ ...getGameRequirements(state).scope, type: 'ACTIVITY' });
  }

  function action(data: GameEventData, activate = false) {
    if (!state || state.session.sessionId !== roundsRef.current?.sessionId)
      return;
    activity();
    if (activate) void ownerRef.current?.audio.activate();
    dispatch({ ...getGameRequirements(state).scope, ...data });
  }

  return {
    state,
    start,
    activity,
    answer: (itemId: string) =>
      action({ type: 'ANSWER', itemId, at: clock.now() }),
    repeat: () => action({ type: 'REPEAT', at: clock.now() }, true),
    retry: () => action({ type: 'RETRY', at: clock.now() }, true),
    continueGame: () => action({ type: 'CONTINUE', at: clock.now() }, true),
    exit,
    imageFailed: (path: string) => {
      if (!state) return;
      dispatch({
        ...getGameRequirements(state).scope,
        type: 'IMAGE_FAILED',
        path,
      });
    },
    tintedPixels: (path: string, hex: string) =>
      ownerRef.current?.tintedImages.get(path, hex),
    imageUrl: (path: string) =>
      ownerRef.current?.images.get(path)?.src ?? assetUrl(path),
  };
}

export type GameSessionController = ReturnType<typeof useGameSession>;
