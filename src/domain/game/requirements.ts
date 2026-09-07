import { gameTiming } from './timing.ts';
import type { GameState, OperationScope, Resource } from './models.ts';
import { audioResource } from './resources.ts';

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
        timeoutAt: number | null;
      }>
    | Readonly<{
        kind: 'wait';
        timer: Readonly<{
          type: 'IDLE_DUE' | 'RETRY_DUE' | 'ADVANCE_DUE';
          at: number;
        }> | null;
      }>
    | Readonly<{ kind: 'next-round'; roundId: number }>
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
      if (confirmation.status === 'loading') {
        return {
          scope,
          work: {
            kind: 'prepare',
            resources: [resource],
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
        work: { kind: 'next-round', roundId: state.round.roundId + 1 },
      };
    case 'paused':
    case 'error':
    case 'ended':
      return { scope, work: { kind: 'stop' } };
  }
}
