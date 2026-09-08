import { gameTiming } from './timing.ts';
import type { InteractionId } from '../../content/types.ts';
import type { GameState, OperationScope, Resource } from './models.ts';
import { audioResource } from './resources.ts';
import type { AnswerCount } from './exercise.ts';

export type GameRequirements = Readonly<{
  scope: OperationScope;
  work:
    | Readonly<{
        kind: 'prepare';
        resources: readonly Resource[];
        timeoutAt: number;
      }>
    | Readonly<{
        kind: 'play';
        resource: Resource;
        started: boolean;
        introduction: InteractionId | null;
        timeoutAt: number | null;
      }>
    | Readonly<{
        kind: 'wait';
        timer: Readonly<{
          type: 'IDLE_DUE' | 'RETRY_DUE' | 'ADVANCE_DUE';
          at: number;
        }> | null;
      }>
    | Readonly<{
        kind: 'next-round';
        roundId: number;
        optionCount: AnswerCount;
      }>
    | Readonly<{ kind: 'stop' }>;
}>;

export function getGameRequirements(state: GameState): GameRequirements {
  const scope: OperationScope = {
    sessionId: state.session.sessionId,
    roundId: state.round.roundId,
    operationId: state.operationId,
  };
  switch (state.status) {
    case 'preparing':
      return {
        scope,
        work:
          state.stage === 'resources'
            ? {
                kind: 'prepare',
                resources: state.pending,
                timeoutAt: state.requestedAt + gameTiming.resourceTimeout,
              }
            : {
                kind: 'play',
                resource: audioResource(state.session, state.round, 'prompt'),
                started: false,
                introduction: state.introduction,
                timeoutAt: state.requestedAt + gameTiming.resourceTimeout,
              },
      };
    case 'awaiting':
      return {
        scope,
        work:
          state.prompt.status === 'playing'
            ? {
                kind: 'play',
                resource: audioResource(state.session, state.round, 'prompt'),
                started: true,
                introduction: state.introduction,
                timeoutAt: null,
              }
            : {
                kind: 'wait',
                timer:
                  state.prompt.idleAt === null
                    ? null
                    : { type: 'IDLE_DUE', at: state.prompt.idleAt },
              },
      };
    case 'correct': {
      const confirmation = state.confirmation;
      if (confirmation.status === 'ended') {
        return {
          scope,
          work: {
            kind: 'wait',
            timer: {
              type: 'ADVANCE_DUE',
              at: Math.max(
                state.acceptedAt + gameTiming.correctReaction,
                confirmation.endedAt + gameTiming.afterConfirmation,
              ),
            },
          },
        };
      }
      const resource = audioResource(
        state.session,
        state.round,
        'confirmation',
      );
      if (
        confirmation.status === 'loading' ||
        confirmation.status === 'repairing-image'
      ) {
        return {
          scope,
          work: {
            kind: 'prepare',
            resources: [
              confirmation.status === 'repairing-image'
                ? confirmation.resource
                : resource,
            ],
            timeoutAt: confirmation.requestedAt + gameTiming.resourceTimeout,
          },
        };
      }
      return {
        scope,
        work: {
          kind: 'play',
          resource,
          started: confirmation.status === 'playing',
          introduction: state.introduction,
          timeoutAt:
            confirmation.status === 'playing'
              ? null
              : confirmation.requestedAt + gameTiming.resourceTimeout,
        },
      };
    }
    case 'retrying':
      return {
        scope,
        work: { kind: 'wait', timer: { type: 'RETRY_DUE', at: state.retryAt } },
      };
    case 'transitioning':
      return {
        scope,
        work: {
          kind: 'next-round',
          roundId: state.round.roundId + 1,
          optionCount: state.adaptation.answerCount,
        },
      };
    case 'paused':
    case 'error':
    case 'ended':
      return { scope, work: { kind: 'stop' } };
  }
}
