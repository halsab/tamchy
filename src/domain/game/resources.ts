import type {
  Failure,
  GameSession,
  GameState,
  Resource,
  Round,
} from './models.ts';

export function audioResource(
  session: GameSession,
  round: Round,
  kind: 'prompt' | 'confirmation',
): Resource {
  const target = session.items.find(({ id }) => id === round.targetId)!;
  return {
    kind,
    path: kind === 'prompt' ? target.promptAudio : target.labelAudio,
  };
}

export function roundResources(
  session: GameSession,
  round: Round,
): readonly Resource[] {
  const paths = round.optionIds.flatMap((id) => {
    const item = session.items.find((item) => item.id === id)!;
    switch (item.kind) {
      case 'color':
        return [];
      case 'animal':
        return [item.image];
      case 'number':
        return [item.countImage];
    }
  });
  return [
    ...[...new Set(paths)].map((path): Resource => ({ kind: 'image', path })),
    audioResource(session, round, 'prompt'),
  ];
}

export function sameResource(left: Resource, right: Resource) {
  return left.kind === right.kind && left.path === right.path;
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
          : [audioResource(state.session, state.round, 'prompt')],
      requestedAt: state.requestedAt,
    };
  }
  if (state.status === 'awaiting' && state.prompt.status === 'playing') {
    return {
      phase: 'prompt',
      resources: [audioResource(state.session, state.round, 'prompt')],
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
