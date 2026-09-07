import { gameTiming } from './timing.ts';
import type {
  ActivePhase,
  GameCategory,
  GameEvent,
  GameSession,
  GameState,
  Round,
  RoundContext,
} from './models.ts';
import {
  audioResource,
  pendingWork,
  roundResources,
  sameResource,
} from './resources.ts';

function context(state: RoundContext): RoundContext {
  return {
    session: state.session,
    round: state.round,
    operationId: state.operationId,
    mistakes: state.mistakes,
    reminderUsed: state.reminderUsed,
  };
}

function changeOperation(state: RoundContext, phase: ActivePhase): GameState {
  return { ...context(state), operationId: state.operationId + 1, ...phase };
}

function prepareRound(state: RoundContext, at: number): GameState {
  return changeOperation(state, {
    status: 'preparing',
    stage: 'resources',
    pending: roundResources(state.session, state.round),
    requestedAt: at,
  });
}

function startPrompt(state: RoundContext, at: number): GameState {
  return changeOperation(state, {
    status: 'preparing',
    stage: 'prompt',
    requestedAt: at,
  });
}

function validRound(session: GameSession, round: Round) {
  return (
    round.categoryId === session.categoryId &&
    round.optionIds.length === 2 &&
    round.optionIds[0] !== round.optionIds[1] &&
    round.optionIds.includes(round.targetId) &&
    round.optionIds.every((id) => session.items.some((item) => item.id === id))
  );
}

function copyRound(round: Round): Round {
  return { ...round, optionIds: [...round.optionIds] };
}

export function createGame(
  sessionId: string,
  category: GameCategory,
  round: Round,
  at: number,
): GameState {
  const session: GameSession = {
    sessionId,
    categoryId: category.id,
    items: category.items.map((item) => ({ ...item })),
  };
  if (round.roundId !== 1 || !validRound(session, round))
    throw new Error('Недопустимый первый раунд.');
  return prepareRound(
    {
      session,
      round: copyRound(round),
      operationId: 0,
      mistakes: 0,
      reminderUsed: false,
    },
    at,
  );
}

export function hasHint(state: GameState) {
  const phase = state.status === 'paused' ? state.resume : state;
  return (
    state.mistakes >= 2 &&
    phase.status !== 'ended' &&
    phase.status !== 'correct' &&
    phase.status !== 'transitioning' &&
    !(phase.status === 'error' && phase.failure.phase === 'confirmation')
  );
}

export function gameReducer(state: GameState, event: GameEvent): GameState {
  if (
    state.status === 'ended' ||
    event.sessionId !== state.session.sessionId ||
    event.roundId !== state.round.roundId ||
    event.operationId !== state.operationId
  )
    return state;

  switch (event.type) {
    case 'EXIT':
      return {
        ...context(state),
        operationId: state.operationId + 1,
        status: 'ended',
      };
    case 'PAUSE': {
      if (state.status === 'paused') return state;
      const { session, round, operationId, mistakes, reminderUsed, ...resume } =
        state;
      return {
        session,
        round,
        operationId: operationId + 1,
        mistakes,
        reminderUsed,
        status: 'paused',
        resume,
      };
    }
    case 'CONTINUE': {
      if (state.status !== 'paused') return state;
      const resume = state.resume;
      // После принятого ответа продолжение заменяет прерванное подтверждение одним переходом.
      if (resume.status === 'correct' || resume.status === 'transitioning') {
        return changeOperation(state, {
          status: 'transitioning',
          acceptedAt: resume.acceptedAt,
        });
      }
      if (resume.status === 'error') {
        if (resume.failure.phase === 'confirmation') {
          return changeOperation(state, {
            status: 'transitioning',
            acceptedAt: resume.failure.acceptedAt,
          });
        }
        return changeOperation(state, resume);
      }
      return prepareRound(state, event.at);
    }
    case 'ROUND_GENERATED':
      if (
        state.status !== 'transitioning' ||
        event.round.roundId !== state.round.roundId + 1 ||
        event.round.targetId === state.round.targetId ||
        !validRound(state.session, event.round)
      )
        return state;
      return prepareRound(
        {
          ...context(state),
          round: copyRound(event.round),
          mistakes: 0,
          reminderUsed: false,
        },
        event.at,
      );
    case 'RESOURCE_FAILED':
    case 'RESOURCE_TIMEOUT': {
      const work = pendingWork(state);
      if (
        !work ||
        !work.resources.some((resource) =>
          sameResource(resource, event.resource),
        )
      )
        return state;
      if (
        event.type === 'RESOURCE_TIMEOUT' &&
        (work.requestedAt === null ||
          event.at < work.requestedAt + gameTiming.resourceTimeout)
      )
        return state;
      const failure = {
        resource: { ...event.resource },
        reason:
          event.type === 'RESOURCE_TIMEOUT'
            ? ('timeout' as const)
            : event.reason,
      };
      if (state.status === 'correct') {
        return changeOperation(state, {
          status: 'error',
          failure: {
            ...failure,
            phase: 'confirmation',
            acceptedAt: state.acceptedAt,
          },
        });
      }
      return changeOperation(state, {
        status: 'error',
        failure: {
          ...failure,
          phase: work.phase === 'preparation' ? 'preparation' : 'prompt',
        },
      });
    }
    case 'RETRY':
      if (state.status !== 'error') return state;
      if (state.failure.phase === 'confirmation') {
        return changeOperation(state, {
          status: 'correct',
          acceptedAt: state.failure.acceptedAt,
          confirmation: { status: 'loading', requestedAt: event.at },
        });
      }
      return prepareRound(state, event.at);
    case 'RESOURCE_READY':
      if (
        state.status === 'preparing' &&
        state.stage === 'resources' &&
        state.pending.some((resource) => sameResource(resource, event.resource))
      ) {
        const pending = state.pending.filter(
          (resource) => !sameResource(resource, event.resource),
        );
        return pending.length === 0
          ? startPrompt(state, event.at)
          : { ...state, pending };
      }
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'loading' &&
        sameResource(
          audioResource(state.session, state.round, 'confirmation'),
          event.resource,
        )
      ) {
        return changeOperation(state, {
          status: 'correct',
          acceptedAt: state.acceptedAt,
          confirmation: { status: 'starting', requestedAt: event.at },
        });
      }
      return state;
    case 'AUDIO_STARTED':
      if (state.status === 'preparing' && state.stage === 'prompt') {
        return {
          ...context(state),
          status: 'awaiting',
          prompt: { status: 'playing', startedAt: event.at },
        };
      }
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'starting'
      ) {
        return {
          ...state,
          confirmation: { status: 'playing', startedAt: event.at },
        };
      }
      return state;
    case 'AUDIO_ENDED':
      if (
        state.status === 'awaiting' &&
        state.prompt.status === 'playing' &&
        event.at >= state.prompt.startedAt
      ) {
        return {
          ...state,
          prompt: {
            status: 'ended',
            idleAt: state.reminderUsed
              ? null
              : event.at + gameTiming.idleReminder,
          },
        };
      }
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'playing' &&
        event.at >= state.confirmation.startedAt
      ) {
        return {
          ...state,
          confirmation: { status: 'ended', endedAt: event.at },
        };
      }
      return state;
    case 'ANSWER':
      if (
        state.status !== 'awaiting' ||
        !state.round.optionIds.includes(event.itemId)
      )
        return state;
      if (event.itemId === state.round.targetId) {
        return changeOperation(state, {
          status: 'correct',
          acceptedAt: event.at,
          confirmation: { status: 'loading', requestedAt: event.at },
        });
      }
      return changeOperation(
        { ...context(state), mistakes: state.mistakes + 1 },
        {
          status: 'retrying',
          selectedId: event.itemId,
          retryAt: event.at + gameTiming.wrongReaction,
        },
      );
    case 'RETRY_DUE':
      return state.status === 'retrying' && event.at >= state.retryAt
        ? startPrompt(state, event.at)
        : state;
    case 'ADVANCE_DUE':
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'ended' &&
        event.at >= state.acceptedAt + gameTiming.correctReaction &&
        event.at >= state.confirmation.endedAt + gameTiming.afterConfirmation
      ) {
        return changeOperation(state, {
          status: 'transitioning',
          acceptedAt: state.acceptedAt,
        });
      }
      return state;
    case 'REPEAT':
      if (
        state.status === 'awaiting' ||
        (state.status === 'preparing' && state.stage === 'prompt')
      )
        return startPrompt(state, event.at);
      if (state.status === 'preparing') return prepareRound(state, event.at);
      return state;
    case 'IDLE_DUE':
      if (
        state.status === 'awaiting' &&
        state.prompt.status === 'ended' &&
        state.prompt.idleAt !== null &&
        event.at >= state.prompt.idleAt
      ) {
        return startPrompt({ ...context(state), reminderUsed: true }, event.at);
      }
      return state;
    case 'ACTIVITY':
      if (
        state.status === 'awaiting' &&
        state.prompt.status === 'ended' &&
        state.prompt.idleAt !== null
      ) {
        return { ...state, prompt: { status: 'ended', idleAt: null } };
      }
      return state;
    default:
      return state;
  }
}
