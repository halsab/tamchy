import type { CountIllustration } from './exercise.ts';
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
  const images: Resource[] = [];
  const addObject = (object: CountIllustration) =>
    images.push(
      object.kind === 'raster'
        ? { kind: 'image', path: object.image }
        : { kind: 'tinted-image', path: object.image, hex: object.hex },
    );
  for (const option of round.options) {
    if (option.kind === 'animal')
      images.push({ kind: 'image', path: option.image });
    if (option.kind === 'shape' || option.kind === 'sized-shape') {
      const shape = session.content.shapes.find(
        (x) => x.id === option.shapeId,
      )!;
      const object = session.content.countObjects.find(
        (x) => x.id === shape.countObjectId,
      )!;
      addObject({
        kind: 'tinted',
        id: object.id,
        image: object.image,
        hex: session.content.colors.find((x) => x.id === option.colorId)!.hex,
      });
    }
  }
  if ('countObject' in round) addObject(round.countObject);
  const prompt = round.prompt;
  if ('countObject' in prompt) addObject(prompt.countObject);
  if (prompt.kind === 'tinted-object') addObject(prompt.object);
  if (prompt.kind === 'silhouette')
    images.push({ kind: 'image', path: prompt.image });
  const resources = [
    ...images,
    ...audioResources(session, round, 'prompt'),
    ...audioResources(session, round, 'confirmation'),
  ];
  return resources.filter(
    (resource, index) =>
      !resources.slice(0, index).some((other) => sameResource(resource, other)),
  );
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
      resources:
        state.confirmation.status === 'repairing-image'
          ? [state.confirmation.resource]
          : confirmationResources(state),
      requestedAt:
        state.confirmation.status === 'playing'
          ? null
          : state.confirmation.requestedAt,
    };
  }
  return null;
}

export function confirmationResources(state: GameState): readonly Resource[] {
  if (state.round.confirmation.type !== 'visual')
    return audioResources(state.session, state.round, 'confirmation');
  return state.introduction
    ? [
        {
          kind: 'confirmation',
          path: state.session.content.audio.find(
            (x) => x.id === `interaction.${state.introduction}`,
          )!.path,
        },
      ]
    : [];
}
