import { gameTiming } from './timing.ts';
import type { InteractionId } from '../../content/types.ts';
import type { GameState, OperationScope, Resource } from './models.ts';
import {
  audioResource,
  audioResources,
  confirmationResources,
} from './resources.ts';
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
        sequence: readonly string[];
        started: boolean;
        optional?: true;
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
        planning?: Readonly<{
          correctCount: number;
          recentKinds: readonly import('./exercise.ts').ExerciseKind[];
        }>;
      }>
    | Readonly<{ kind: 'stop' }>;
}>;

export function getGameRequirements(state: GameState): GameRequirements {
  const scope: OperationScope = {
    sessionId: state.session.sessionId,
    roundId: state.round.id,
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
                sequence: audioResources(
                  state.session,
                  state.round,
                  'prompt',
                ).map((resource) => resource.path),
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
                sequence: audioResources(
                  state.session,
                  state.round,
                  'prompt',
                ).map((resource) => resource.path),
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
                confirmation.endedAt === null
                  ? 0
                  : confirmation.endedAt + gameTiming.afterConfirmation,
              ),
            },
          },
        };
      }
      const sequence = confirmationResources(state);
      const resource = sequence[0]!;
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
          sequence: sequence.map((resource) => resource.path),
          ...(state.round.confirmation.type === 'visual'
            ? { optional: true as const }
            : {}),
          started: confirmation.status === 'playing',
          introduction:
            state.round.confirmation.type === 'visual'
              ? null
              : state.introduction,
          timeoutAt:
            confirmation.status === 'playing'
              ? null
              : confirmation.requestedAt +
                (state.round.confirmation.type === 'visual'
                  ? 2000
                  : gameTiming.resourceTimeout),
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
          roundId: state.round.id + 1,
          optionCount: state.adaptation.answerCount,
          ...('correctCount' in state.adaptation
            ? {
                planning: {
                  correctCount: state.adaptation.correctCount,
                  recentKinds: state.recentKinds,
                },
              }
            : {}),
        },
      };
    case 'paused':
    case 'error':
    case 'ended':
      return { scope, work: { kind: 'stop' } };
  }
}
