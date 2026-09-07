import { useLayoutEffect, useReducer, useRef } from 'react';
import type {
  GameCategory,
  GameEvent,
  GameEventData,
  GameState,
} from '../../domain/game/models.ts';
import { createGame, gameReducer } from '../../domain/game/reducer.ts';
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

export type GameSessionOptions = {
  audio?: Partial<AudioBoundary>;
  images?: Partial<ImageBoundary>;
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
  executor: GameExecutor | null;
  restoring: boolean;
};

export function useGameSession(options: GameSessionOptions = defaultOptions) {
  const [state, dispatch] = useReducer(sessionReducer, null);
  const ownerRef = useRef<Owner | null>(null);
  const roundsRef = useRef<SessionRounds | null>(null);
  const clock = options.clock ?? browserClock;

  useLayoutEffect(() => {
    const owner: Owner = {
      audio: createAudioService(options.audio),
      images: createImageService(options.images),
      executor: null,
      restoring: roundsRef.current !== null,
    };
    ownerRef.current = owner;
    let attached = true;
    const visibility = options.visibility ?? browserVisibility;
    function notify(event: 'PAUSE' | 'RETURN') {
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
      owner.audio.dispose();
      owner.images.dispose();
      ownerRef.current = null;
    };
  }, [options]);

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
    owner.executor.reconcile(getGameRequirements(state));
  }, [state, clock, options]);

  function start(category: GameCategory) {
    const owner = ownerRef.current;
    if (!owner) return;
    owner.executor?.dispose();
    owner.executor = null;
    owner.restoring = false;
    void owner.audio.activate();
    const sessionId = options.createSessionId?.() ?? crypto.randomUUID();
    const rounds = createSessionRounds(
      sessionId,
      category,
      options.random ?? Math.random,
    );
    roundsRef.current = rounds;
    const initial = createGame(sessionId, category, rounds.get(1), clock.now());
    dispatch({ type: 'START', initial });
    if ((options.visibility ?? browserVisibility).hidden())
      dispatch({ type: 'CONTROL', sessionId, event: 'PAUSE' });
  }

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
    if (data.type === 'EXIT') {
      const owner = ownerRef.current;
      owner?.executor?.dispose();
      if (owner) owner.executor = null;
      roundsRef.current = null;
      dispatch({
        type: 'CONTROL',
        sessionId: state.session.sessionId,
        event: 'EXIT',
      });
      return;
    }
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
    exit: () => action({ type: 'EXIT' }),
  };
}
