import type { SeniorAdaptation } from './senior-adaptation.ts';
import type { CategoryId, ContentV2 } from '../../content/types.ts';
import type { InteractionId } from '../../content/types.ts';
import type { AgeMode, Exercise, ExerciseKind } from './exercise.ts';
import type { JuniorAdaptation } from './adaptation.ts';

export type GameCategory = Readonly<{
  mode?: AgeMode;
  id: CategoryId;
  content: ContentV2;
}>;

export type GameSession = Readonly<{
  mode: AgeMode;
  sessionId: string;
  categoryId: CategoryId;
  content: ContentV2;
}>;

export type Round = Exercise;

export type OperationScope = Readonly<{
  sessionId: string;
  roundId: number;
  operationId: number;
}>;

export type Resource =
  | Readonly<{ kind: 'image' | 'prompt' | 'confirmation'; path: string }>
  | Readonly<{ kind: 'tinted-image'; path: string; hex: string }>;

export type Failure = Readonly<{
  resource: Resource;
  reason: 'load' | 'decode' | 'blocked' | 'timeout';
}> &
  (
    | Readonly<{ phase: 'preparation' | 'prompt' }>
    | Readonly<{ phase: 'confirmation'; acceptedAt: number }>
  );

type Confirmation =
  | Readonly<{
      status: 'repairing-image';
      resource: Resource;
      requestedAt: number;
    }>
  | Readonly<{ status: 'loading' | 'starting'; requestedAt: number }>
  | Readonly<{ status: 'playing'; startedAt: number }>
  | Readonly<{ status: 'ended'; endedAt: number | null }>;

export type ActivePhase =
  | Readonly<{
      status: 'preparing';
      stage: 'resources';
      pending: readonly Resource[];
      requestedAt: number;
    }>
  | Readonly<{
      status: 'preparing';
      stage: 'prompt';
      requestedAt: number;
    }>
  | Readonly<{
      status: 'awaiting';
      prompt:
        | Readonly<{ status: 'playing'; startedAt: number }>
        | Readonly<{ status: 'ended'; idleAt: number | null }>;
    }>
  | Readonly<{
      status: 'correct';
      acceptedAt: number;
      confirmation: Confirmation;
    }>
  | Readonly<{ status: 'retrying'; selectedId: string; retryAt: number }>
  | Readonly<{ status: 'transitioning'; acceptedAt: number }>
  | Readonly<{ status: 'error'; failure: Failure }>;

export type RoundContext = Readonly<{
  session: GameSession;
  round: Round;
  operationId: number;
  mistakes: number;
  reminderUsed: boolean;
  introduction: InteractionId | null;
  adaptation: JuniorAdaptation | SeniorAdaptation;
  recentKinds: readonly ExerciseKind[];
}>;

export type GameState = RoundContext &
  (
    | ActivePhase
    | Readonly<{ status: 'paused'; resume: ActivePhase }>
    | Readonly<{ status: 'ended' }>
  );

export type GameEventData =
  | Readonly<{ type: 'IMAGE_FAILED'; path: string; hex?: string }>
  | Readonly<{ type: 'RESOURCE_READY'; resource: Resource; at: number }>
  | Readonly<{
      type: 'RESOURCE_FAILED';
      resource: Resource;
      reason: 'load' | 'decode' | 'blocked';
    }>
  | Readonly<{
      type: 'RESOURCE_TIMEOUT';
      resource: Resource;
      at: number;
    }>
  | Readonly<{
      type: 'AUDIO_STARTED' | 'AUDIO_ENDED' | 'REACTION_SKIPPED';
      at: number;
    }>
  | Readonly<{ type: 'ANSWER'; itemId: string; at: number }>
  | Readonly<{
      type:
        | 'REPEAT'
        | 'RETRY'
        | 'CONTINUE'
        | 'IDLE_DUE'
        | 'RETRY_DUE'
        | 'ADVANCE_DUE';
      at: number;
    }>
  | Readonly<{ type: 'ROUND_GENERATED'; round: Round; at: number }>
  | Readonly<{
      type:
        | 'PAUSE'
        | 'RETURN'
        | 'EXIT'
        | 'ACTIVITY'
        | 'AUDIO_CANCELLED'
        | 'DECOR_FAILED';
    }>;

export type GameEvent = OperationScope & GameEventData;
