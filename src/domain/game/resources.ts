import { audioClipIds } from './exercise.ts';
import type {
  Failure,
  GameSession,
  GameState,
  Resource,
  Round,
} from './models.ts';

export function audioResources(
  session: GameSession,
  round: Round,
  kind: 'prompt' | 'confirmation',
): readonly Resource[] {
  return audioClipIds(
    kind === 'prompt' ? round.prompt.audio : round.confirmation,
  ).map((id) => ({
    kind,
    path: session.content.audio.find((clip) => clip.id === id)!.path,
  }));
}

export function audioResource(
  session: GameSession,
  round: Round,
  kind: 'prompt' | 'confirmation',
): Resource {
  return audioResources(session, round, kind)[0]!;
}

export function roundResources(
  session: GameSession,
  round: Round,
): readonly Resource[] {
  const images: Resource[] =
    round.kind === 'A1'
      ? round.options.map((option) => ({ kind: 'image', path: option.image }))
      : round.kind === 'N1-A'
        ? [
            round.countObject.kind === 'raster'
              ? { kind: 'image', path: round.countObject.image }
              : {
                  kind: 'tinted-image',
                  path: round.countObject.image,
                  hex: round.countObject.hex,
                },
          ]
        : [];
  return [
    ...images,
    ...audioResources(session, round, 'prompt'),
    ...audioResources(session, round, 'confirmation'),
  ];
}

export function isImageResource(resource: Resource) {
  return resource.kind === 'image' || resource.kind === 'tinted-image';
}

export function sameResource(left: Resource, right: Resource) {
  return (
    left.kind === right.kind &&
    left.path === right.path &&
    (left.kind !== 'tinted-image' ||
      (right.kind === 'tinted-image' && left.hex === right.hex))
  );
}

export function pendingWork(state: GameState): {
  phase: Failure['phase'];
  resources: readonly Resource[];
  requestedAt: number | null;
} | null {
  if (state.status === 'preparing') {
    return {
      phase: state.stage === 'resources' ? 'preparation' : 'prompt',
      resources:
        state.stage === 'resources'
          ? state.pending
          : audioResources(state.session, state.round, 'prompt'),
      requestedAt: state.requestedAt,
    };
  }
  if (state.status === 'awaiting' && state.prompt.status === 'playing') {
    return {
      phase: 'prompt',
      resources: audioResources(state.session, state.round, 'prompt'),
      requestedAt: null,
    };
  }
  if (state.status === 'correct' && state.confirmation.status !== 'ended') {
    return {
      phase: 'confirmation',
      resources: [
        state.confirmation.status === 'repairing-image'
          ? state.confirmation.resource
          : audioResource(state.session, state.round, 'confirmation'),
      ],
      requestedAt:
        state.confirmation.status === 'playing'
          ? null
          : state.confirmation.requestedAt,
    };
  }
  return null;
}
