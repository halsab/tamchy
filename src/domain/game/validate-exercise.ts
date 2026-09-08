import { resolveRecipe } from './audio-recipes.ts';
import type { ContentV2 } from '../../content/types.ts';
import type { GameSession } from './models.ts';
import type {
  AudioPrompt,
  CountIllustration,
  Exercise,
  Option,
} from './exercise.ts';
import { audioClipIds, exerciseDefinitions } from './exercise.ts';
import { silhouettePairKey } from './silhouettes.ts';

function keys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}
function integer(value: number, max = 10) {
  return Number.isInteger(value) && value >= 1 && value <= max;
}
function same(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function validAudio(audio: AudioPrompt, content: ContentV2) {
  return (
    ((audio.type === 'clip' && keys(audio, ['type', 'clipId'])) ||
      (audio.type === 'sequence' && keys(audio, ['type', 'clipIds']))) &&
    audioClipIds(audio).length > 0 &&
    audioClipIds(audio).every((id) =>
      content.audio.some((x) => x.id === id && !id.startsWith('interaction.')),
    )
  );
}
function illustration(object: CountIllustration, content: ContentV2) {
  return (
    keys(
      object,
      object.kind === 'raster'
        ? ['kind', 'id', 'image']
        : ['kind', 'id', 'image', 'hex'],
    ) &&
    content.countObjects.some(
      (x) =>
        x.id === object.id &&
        x.image === object.image &&
        x.kind === object.kind,
    ) &&
    (object.kind === 'raster' ||
      content.colors.some((x) => x.hex === object.hex))
  );
}
function optionKey(option: Option) {
  switch (option.kind) {
    case 'color':
      return option.hex;
    case 'animal':
      return option.image;
    case 'number':
    case 'group':
      return String(option.value);
    case 'shape':
      return `${option.shapeId}:${option.colorId}`;
    case 'sized-shape':
      return `${option.shapeId}:${option.colorId}:${option.sizeId}`;
  }
}
function validOption(option: Option, content: ContentV2, numberMax: number) {
  if (!option.id.trim() || !option.labelTt.trim()) return false;
  const base = ['kind', 'id', 'labelTt'];
  switch (option.kind) {
    case 'color':
      return (
        keys(option, [...base, 'hex']) &&
        content.colors.some(
          (x) =>
            option.id === `color-${x.id}` &&
            option.hex === x.hex &&
            option.labelTt === x.labelTt,
        )
      );
    case 'animal':
      return (
        keys(option, [...base, 'image']) &&
        content.animals.some(
          (x) =>
            option.id === x.id &&
            option.image === x.image &&
            option.labelTt === x.labelTt,
        )
      );
    case 'number':
      return (
        keys(option, [...base, 'value']) &&
        integer(option.value, numberMax) &&
        content.numbers.some(
          (x) =>
            x.id === option.id &&
            x.value === option.value &&
            x.labelTt === option.labelTt,
        )
      );
    case 'group':
      return keys(option, [...base, 'value']) && integer(option.value);
    case 'shape':
    case 'sized-shape':
      return (
        keys(option, [
          ...base,
          'shapeId',
          'colorId',
          ...(option.kind === 'sized-shape' ? ['sizeId'] : []),
        ]) &&
        content.shapes.some((x) => x.id === option.shapeId) &&
        content.colors.some((x) => x.id === option.colorId) &&
        (option.kind === 'shape' ||
          content.sizes.some((x) => x.id === option.sizeId))
      );
    default:
      return false;
  }
}

export function validExercise(
  session: Pick<GameSession, 'categoryId' | 'content' | 'mode'>,
  input: unknown,
  count: number,
): input is Exercise {
  // Граница принимает также повреждённые внешние данные; ошибки структуры не выходят в игровой автомат.
  try {
    return validate(session, input as Exercise, count);
  } catch {
    return false;
  }
}
function validate(
  session: Pick<GameSession, 'categoryId' | 'content' | 'mode'>,
  round: Exercise,
  count: number,
): boolean {
  const content = session.content;
  const junior = session.mode === 'junior';
  if (
    round.mode !== session.mode ||
    round.categoryId !== session.categoryId ||
    !integer(round.id, Number.MAX_SAFE_INTEGER) ||
    ![...(junior ? [2, 3, 4] : [4, 5, 6])].includes(count) ||
    round.options.length !== (round.kind === 'N2' ? 2 : count)
  )
    return false;
  if (junior && !['C1', 'A1', 'N1-A'].includes(round.kind)) return false;
  const definition = exerciseDefinitions[round.kind];
  if (
    !definition ||
    round.difficulty !== definition.difficulty ||
    round.categoryId !== definition.categoryId
  )
    return false;
  const counted =
    round.kind === 'N1-C' ||
    round.kind === 'N2' ||
    (junior && round.kind === 'N1-A');
  if (
    !keys(round, [
      'mode',
      'id',
      'kind',
      'categoryId',
      'difficulty',
      'prompt',
      'options',
      'correctOptionId',
      'confirmation',
      ...(counted ? ['countObject'] : []),
    ])
  )
    return false;
  if (
    counted &&
    !illustration(
      (round as Extract<Exercise, { countObject: CountIllustration }>)
        .countObject,
      content,
    )
  )
    return false;
  const numberMax = round.kind === 'N1-A' && !junior ? 20 : 10;
  if (
    !round.options.every((x) => validOption(x, content, numberMax)) ||
    new Set(round.options.map((x) => x.id)).size !== round.options.length ||
    new Set(round.options.map(optionKey)).size !== round.options.length
  )
    return false;
  const correct = round.options.find((x) => x.id === round.correctOptionId);
  if (
    !correct ||
    !round.prompt.textTt.trim() ||
    !validAudio(round.prompt.audio, content)
  )
    return false;
  const speech = ['kind', 'textTt', 'audio'];
  const p = round.prompt;
  let matches: readonly Option[];
  let confirmation: string[] = [];
  const bindings: Record<string, string> = {};
  const color =
    correct.kind === 'color'
      ? content.colors.find((x) => x.hex === correct.hex)
      : undefined;
  const animal =
    correct.kind === 'animal'
      ? content.animals.find((x) => x.id === correct.id)
      : undefined;
  const number =
    correct.kind === 'number' || correct.kind === 'group'
      ? content.numbers.find((x) => x.value === correct.value)
      : undefined;
  if (color) {
    bindings.$label = color.labelClipId;
    confirmation = [color.labelClipId];
  }
  if (animal) {
    bindings.$label = animal.labelClipId;
    bindings.$target = animal.targetClipId;
    confirmation = [animal.labelClipId];
  }
  if (number) {
    bindings.$label = number.labelClipId;
    bindings.$target = number.targetClipId;
    bindings.$number = number.labelClipId;
    confirmation = [number.labelClipId];
  }
  function objectBinding(object: CountIllustration) {
    if (!illustration(object, content)) return false;
    bindings.$countObject = content.countObjects.find(
      (x) => x.id === object.id,
    )!.labelClipId;
    return true;
  }
  switch (round.kind) {
    case 'C1':
    case 'A1':
    case 'N1-A':
      if (
        p.kind !== 'spoken' ||
        !keys(p, speech) ||
        !round.options.every(
          (x) =>
            x.kind ===
            (round.kind === 'C1'
              ? 'color'
              : round.kind === 'A1'
                ? 'animal'
                : 'number'),
        )
      )
        return false;
      matches = [correct];
      break;
    case 'C2':
      if (
        p.kind !== 'tinted-object' ||
        !keys(p, [...speech, 'object']) ||
        p.object.kind !== 'tinted' ||
        !illustration(p.object, content) ||
        !round.options.every((x) => x.kind === 'color')
      )
        return false;
      matches = round.options.filter((x) => x.hex === p.object.hex);
      break;
    case 'C3-A':
    case 'C3-B': {
      const sized = round.kind === 'C3-B';
      if (
        p.kind !== (sized ? 'sized-shape-request' : 'shape-request') ||
        !keys(p, [
          ...speech,
          'shapeId',
          'colorId',
          ...(sized ? ['sizeId'] : []),
        ])
      )
        return false;
      if (p.kind !== 'shape-request' && p.kind !== 'sized-shape-request')
        return false;
      const shape = content.shapes.find((x) => x.id === p.shapeId),
        color = content.colors.find((x) => x.id === p.colorId);
      if (
        !shape ||
        !color ||
        !round.options.every(
          (x) => x.kind === (sized ? 'sized-shape' : 'shape'),
        )
      )
        return false;
      bindings.$shapeTarget = shape.targetClipId;
      bindings.$color = color.labelClipId;
      confirmation = [
        color.labelClipId,
        content.countObjects.find((x) => x.id === shape.countObjectId)!
          .labelClipId,
      ];
      if (p.kind === 'sized-shape-request') {
        const size = content.sizes.find((x) => x.id === p.sizeId);
        if (!size) return false;
        bindings.$size = size.labelClipId;
        confirmation.unshift(size.labelClipId);
      }
      matches = round.options.filter(
        (x) =>
          x.shapeId === p.shapeId &&
          x.colorId === p.colorId &&
          (p.kind === 'shape-request' ||
            ('sizeId' in x && x.sizeId === p.sizeId)),
      );
      if (
        !round.options.some(
          (x) => x.id !== round.correctOptionId && x.colorId === p.colorId,
        ) ||
        !round.options.some(
          (x) => x.id !== round.correctOptionId && x.shapeId === p.shapeId,
        )
      )
        return false;
      break;
    }
    case 'C4': {
      if (
        p.kind !== 'color-sequence' ||
        !keys(p, [...speech, 'pattern', 'colorIds']) ||
        !['ABAB', 'AABAAB', 'ABCABC'].includes(p.pattern) ||
        p.colorIds.length !== p.pattern.length ||
        !round.options.every((x) => x.kind === 'color')
      )
        return false;
      const colors = new Map<string, string>();
      for (let i = 0; i < p.pattern.length; i++) {
        const letter = p.pattern[i]!,
          id = p.colorIds[i]!;
        if (
          !content.colors.some((x) => x.id === id) ||
          (colors.has(letter) && colors.get(letter) !== id)
        )
          return false;
        colors.set(letter, id);
      }
      if (new Set(colors.values()).size !== colors.size) return false;
      matches = round.options.filter((x) => x.id === `color-${p.colorIds[0]}`);
      break;
    }
    case 'A2':
      if (
        p.kind !== 'trait' ||
        !keys(p, [...speech, 'traitId']) ||
        !content.animalTraits.traits.some(
          (x) => x.id === p.traitId && x.generation === 'enabled',
        ) ||
        !round.options.every((x) => x.kind === 'animal')
      )
        return false;
      for (const option of round.options) {
        const value = content.animalTraits.animals.find(
          (x) => x.animalId === option.id,
        )?.values[p.traitId];
        if (value !== 'yes' && value !== 'no') return false;
      }
      matches = round.options.filter(
        (x) =>
          content.animalTraits.animals.find((a) => a.animalId === x.id)!.values[
            p.traitId
          ] === 'yes',
      );
      break;
    case 'A3': {
      if (
        p.kind !== 'silhouette' ||
        !keys(p, [...speech, 'animalId', 'image']) ||
        !content.animals.some(
          (x) => x.id === p.animalId && x.image === p.image,
        ) ||
        !round.options.every((x) => x.kind === 'animal')
      )
        return false;
      const forbidden = new Set(
        content.silhouetteConflicts.pairs.map((x) =>
          silhouettePairKey(...x.animalIds),
        ),
      );
      for (let i = 0; i < round.options.length; i++)
        for (let j = i + 1; j < round.options.length; j++)
          if (
            forbidden.has(
              silhouettePairKey(round.options[i]!.id, round.options[j]!.id),
            )
          )
            return false;
      matches = round.options.filter((x) => x.id === p.animalId);
      break;
    }
    case 'N1-B':
      if (
        p.kind !== 'quantity' ||
        !keys(p, [...speech, 'value', 'countObject']) ||
        !integer(p.value) ||
        !objectBinding(p.countObject) ||
        !round.options.every((x) => x.kind === 'number')
      )
        return false;
      matches = round.options.filter((x) => x.value === p.value);
      break;
    case 'N1-C':
      if (
        p.kind !== 'numeral' ||
        !keys(p, [...speech, 'value']) ||
        !integer(p.value) ||
        !objectBinding(round.countObject) ||
        !round.options.every((x) => x.kind === 'group')
      )
        return false;
      matches = round.options.filter((x) => x.value === p.value);
      break;
    case 'N2': {
      if (
        p.kind !== 'comparison' ||
        !keys(p, [...speech, 'direction']) ||
        !['more', 'less'].includes(p.direction) ||
        !round.options.every((x) => x.kind === 'group')
      )
        return false;
      const values = round.options.map((x) => x.value);
      const value =
        p.direction === 'more' ? Math.max(...values) : Math.min(...values);
      matches = round.options.filter((x) => x.value === value);
      break;
    }
    case 'N3-A':
      if (
        p.kind !== 'addition' ||
        !keys(p, [...speech, 'left', 'right', 'countObject']) ||
        !integer(p.left) ||
        !integer(p.right) ||
        p.left + p.right > 10 ||
        !objectBinding(p.countObject) ||
        !round.options.every((x) => x.kind === 'number')
      )
        return false;
      matches = round.options.filter((x) => x.value === p.left + p.right);
      break;
    case 'N3-B':
      if (
        p.kind !== 'subtraction' ||
        !keys(p, [...speech, 'total', 'removed', 'countObject']) ||
        !integer(p.total) ||
        !integer(p.removed) ||
        p.total <= p.removed ||
        !objectBinding(p.countObject) ||
        !round.options.every((x) => x.kind === 'number')
      )
        return false;
      matches = round.options.filter((x) => x.value === p.total - p.removed);
      break;
    default:
      return false;
  }
  if (matches.length !== 1 || matches[0]!.id !== round.correctOptionId)
    return false;
  const recipes = content.recipes[round.kind].filter((x) =>
    p.kind === 'trait'
      ? x.id === p.traitId
      : p.kind === 'comparison'
        ? x.id === p.direction
        : true,
  );
  if (
    !recipes.some((recipe) => {
      const expected = resolveRecipe(content, recipe, bindings);
      return (
        same(audioClipIds(expected.audio), audioClipIds(p.audio)) &&
        expected.textTt === p.textTt
      );
    })
  )
    return false;
  return round.confirmation.type === 'visual'
    ? ['C3-A', 'C3-B'].includes(round.kind) &&
        keys(round.confirmation, ['type'])
    : validAudio(round.confirmation, content) &&
        same(audioClipIds(round.confirmation), confirmation);
}
