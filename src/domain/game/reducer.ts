import {
  initialSeniorAdaptation,
  recordSeniorResult,
} from './senior-adaptation.ts';
import { allowedSeniorKinds } from './senior-planner.ts';
import { validExercise } from './validate-exercise.ts';
import { gameTiming } from './timing.ts';
import { initialAdaptation, recordRoundResult } from './adaptation.ts';
import type { ContentV2, InteractionId } from '../../content/types.ts';
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
  isImageResource,
} from './resources.ts';

function context(state: RoundContext): RoundContext {
  return {
    session: state.session,
    round: state.round,
    operationId: state.operationId,
    mistakes: state.mistakes,
    reminderUsed: state.reminderUsed,
    introduction: state.introduction,
    adaptation: state.adaptation,
    recentKinds: state.recentKinds,
  };
}

function changeOperation(
  state: RoundContext,
  phase: ActivePhase,
  introduction = state.introduction,
): GameState {
  return {
    ...context(state),
    operationId: state.operationId + 1,
    introduction,
    ...phase,
  };
}

function prepareRound(
  state: RoundContext,
  at: number,
  introduction: InteractionId | null = null,
): GameState {
  return changeOperation(
    state,
    {
      status: 'preparing',
      stage: 'resources',
      pending: roundResources(state.session, state.round),
      requestedAt: at,
    },
    introduction,
  );
}

function startPrompt(
  state: RoundContext,
  at: number,
  introduction = state.introduction,
): GameState {
  return changeOperation(
    state,
    {
      status: 'preparing',
      stage: 'prompt',
      requestedAt: at,
    },
    introduction,
  );
}

function copyRound(round: Round): Round {
  // Упражнение содержит только JSON; копируются также вложенные сцены и последовательности.
  return JSON.parse(JSON.stringify(round)) as Round;
}

function initialConfirmation(
  round: Round,
  at: number,
  introduction: InteractionId | null,
) {
  return round.confirmation.type !== 'visual'
    ? { status: 'loading' as const, requestedAt: at }
    : introduction
      ? { status: 'starting' as const, requestedAt: at }
      : { status: 'ended' as const, endedAt: null };
}

export function createGame(
  sessionId: string,
  category: GameCategory,
  round: Round,
  at: number,
  introduction: 'hello' | 'game-start' = 'hello',
): GameState {
  const session: GameSession = {
    sessionId,
    mode: category.mode ?? 'junior',
    categoryId: category.id,
    // Каталог — проверенные JSON-данные; снимок изолирует сессию от изменений владельца.
    content: JSON.parse(JSON.stringify(category.content)) as ContentV2,
  };
  const adaptation =
    session.mode === 'senior' ? initialSeniorAdaptation() : initialAdaptation();
  if (
    round.id !== 1 ||
    !validExercise(session, round, adaptation.answerCount) ||
    round.difficulty !== 1
  )
    throw new Error('Недопустимый первый раунд.');
  return prepareRound(
    {
      session,
      round: copyRound(round),
      operationId: 0,
      mistakes: 0,
      reminderUsed: false,
      introduction,
      adaptation,
      recentKinds: [round.kind],
    },
    at,
    introduction,
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
    event.roundId !== state.round.id ||
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
      const {
        session,
        round,
        operationId,
        mistakes,
        reminderUsed,
        introduction,
        adaptation,
        recentKinds,
        ...resume
      } = state;
      return {
        session,
        round,
        operationId: operationId + 1,
        mistakes,
        reminderUsed,
        introduction,
        adaptation,
        recentKinds,
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
      return prepareRound(state, event.at, 'continue');
    }
    case 'ROUND_GENERATED':
      if (
        state.status !== 'transitioning' ||
        event.round.id !== state.round.id + 1 ||
        (event.round.correctOptionId === state.round.correctOptionId &&
          (state.session.mode === 'junior' ||
            (event.round.kind === state.round.kind &&
              ['C1', 'A1', 'N1-A'].includes(event.round.kind)))) ||
        ('correctCount' in state.adaptation &&
          !allowedSeniorKinds(
            state.session.categoryId,
            state.adaptation.correctCount,
            state.recentKinds,
          ).some((x) => x.kind === event.round.kind)) ||
        !validExercise(state.session, event.round, state.adaptation.answerCount)
      )
        return state;
      return prepareRound(
        {
          ...context(state),
          round: copyRound(event.round),
          recentKinds: [...state.recentKinds, event.round.kind].slice(-2),
          mistakes: 0,
          reminderUsed: false,
        },
        event.at,
        event.round.id % 5 === 0 ? 'next-one' : null,
      );
    case 'IMAGE_FAILED': {
      const resource = roundResources(state.session, state.round).find(
        (resource) =>
          isImageResource(resource) &&
          resource.path === event.path &&
          (event.hex === undefined ||
            (resource.kind === 'tinted-image' && resource.hex === event.hex)),
      );
      if (!resource) return state;
      if (state.status === 'paused') {
        const failed = gameReducer(
          { ...context(state), ...state.resume },
          event,
        );
        if (failed.status !== 'error') return state;
        return {
          ...context(failed),
          status: 'paused',
          resume: { status: 'error', failure: failed.failure },
        };
      }
      if (
        state.status === 'error' &&
        sameResource(state.failure.resource, resource)
      )
        return state;
      const acceptedAt =
        state.status === 'correct' || state.status === 'transitioning'
          ? state.acceptedAt
          : state.status === 'error' && state.failure.phase === 'confirmation'
            ? state.failure.acceptedAt
            : null;
      return changeOperation(state, {
        status: 'error',
        failure:
          acceptedAt === null
            ? { resource, reason: 'load', phase: 'preparation' }
            : { resource, reason: 'load', phase: 'confirmation', acceptedAt },
      });
    }
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
        return changeOperation(
          state,
          {
            status: 'correct',
            acceptedAt: state.failure.acceptedAt,
            confirmation: isImageResource(state.failure.resource)
              ? {
                  status: 'repairing-image',
                  resource: state.failure.resource,
                  requestedAt: event.at,
                }
              : initialConfirmation(state.round, event.at, null),
          },
          null,
        );
      }
      return prepareRound(
        state,
        event.at,
        state.failure.reason === 'blocked' ? state.introduction : null,
      );
    case 'RESOURCE_READY':
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'repairing-image' &&
        sameResource(state.confirmation.resource, event.resource)
      ) {
        return changeOperation(state, {
          status: 'correct',
          acceptedAt: state.acceptedAt,
          confirmation: initialConfirmation(state.round, event.at, null),
        });
      }
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
        state.round.confirmation.type !== 'visual' &&
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
    case 'REACTION_SKIPPED':
      return state.status === 'correct' &&
        state.round.confirmation.type === 'visual' &&
        state.confirmation.status === 'starting'
        ? changeOperation(
            state,
            {
              status: 'correct',
              acceptedAt: state.acceptedAt,
              confirmation: { status: 'ended', endedAt: null },
            },
            null,
          )
        : state;
    case 'ANSWER':
      if (
        state.status !== 'awaiting' ||
        !state.round.options.some((option) => option.id === event.itemId)
      )
        return state;
      if (event.itemId === state.round.correctOptionId) {
        const praise =
          state.round.id % 2 === 1
            ? (['correct', 'well-done', 'very-good'] as const)[
                ((state.round.id - 1) / 2) % 3
              ]!
            : null;
        return changeOperation(
          {
            ...context(state),
            adaptation:
              'correctCount' in state.adaptation
                ? recordSeniorResult(
                    state.adaptation,
                    state.mistakes > 0,
                    state.round.kind,
                  )
                : recordRoundResult(state.adaptation, state.mistakes > 0),
          },
          {
            status: 'correct',
            acceptedAt: event.at,
            confirmation: initialConfirmation(state.round, event.at, praise),
          },
          praise,
        );
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
        ? startPrompt(
            state,
            event.at,
            (['think-again', 'hint', 'try-again'] as const)[
              state.mistakes - 1
            ] ?? null,
          )
        : state;
    case 'ADVANCE_DUE':
      if (
        state.status === 'correct' &&
        state.confirmation.status === 'ended' &&
        event.at >= state.acceptedAt + gameTiming.correctReaction &&
        (state.confirmation.endedAt === null ||
          event.at >= state.confirmation.endedAt + gameTiming.afterConfirmation)
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
        return startPrompt(state, event.at, null);
      if (state.status === 'preparing') return prepareRound(state, event.at);
      return state;
    case 'IDLE_DUE':
      if (
        state.status === 'awaiting' &&
        state.prompt.status === 'ended' &&
        state.prompt.idleAt !== null &&
        event.at >= state.prompt.idleAt
      ) {
        return startPrompt(
          { ...context(state), reminderUsed: true },
          event.at,
          'listen',
        );
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
