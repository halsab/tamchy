import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readGenerated } from './generated-files.ts';
import { z } from 'zod';
import type { ContentV2 } from '../../src/content/v2/types.ts';
import graphics from '../../src/content/v2/graphics.json' with { type: 'json' };
import {
  findCompatibleAnimals,
  silhouettePairKey,
} from '../../src/domain/game/silhouettes.ts';

const text = z.string().trim().min(1);
const traitId = z.enum(['bird', 'domestic', 'wild', 'canFly', 'canSwim']);
const value = z.enum(['yes', 'no', 'exclude']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const seniorSchemas = {
  shapes: z
    .array(
      z.strictObject({
        id: z.enum([
          'circle',
          'square',
          'triangle',
          'rectangle',
          'oval',
          'star',
        ]),
        countObjectId: text,
        targetClipId: text,
      }),
    )
    .length(6),
  sizes: z
    .array(
      z.strictObject({
        id: z.enum(['big', 'small']),
        labelTt: text,
        labelClipId: text,
      }),
    )
    .length(2),
  animalTraits: z.strictObject({
    version: z.literal(1),
    evaluatedOn: text,
    scopeRu: text,
    valueMeaning: z.strictObject({ yes: text, no: text, exclude: text }),
    traits: z
      .array(
        z.intersection(
          z.strictObject({
            id: traitId,
            clipId: text,
            generation: z.enum(['enabled', 'disabled']),
            decisionRu: text.optional(),
          }),
          z.union([
            z.object({ generation: z.literal('enabled') }),
            z.object({ generation: z.literal('disabled'), decisionRu: text }),
          ]),
        ),
      )
      .length(5),
    sources: z
      .array(z.strictObject({ id: text, title: text, url: text, useRu: text }))
      .min(1),
    animals: z
      .array(
        z.strictObject({
          animalId: text,
          values: z.record(traitId, value),
          exclusions: z.partialRecord(traitId, text),
          sourceIds: z.array(text).min(1),
        }),
      )
      .length(39),
  }),
  silhouetteConflicts: z.strictObject({
    version: z.literal(1),
    evaluatedOn: text,
    scopeRu: text,
    reviewSizesCssPx: z.array(z.number().int().positive()).min(1),
    renderingRu: text,
    pairRuleRu: text,
    animals: z
      .array(
        z.strictObject({
          animalId: text,
          masterSha256: hash,
          webpSha256: hash,
          observationRu: text,
        }),
      )
      .length(39),
    pairs: z
      .array(
        z.strictObject({ animalIds: z.tuple([text, text]), reasonRu: text }),
      )
      .min(1),
  }),
};

// Формулы из утверждённого сценария проверяются независимо от редактируемого JSON.
export const seniorRecipeParts: Record<
  string,
  Record<string, readonly string[]>
> = {
  C2: { color: ['colors.objectColor.prompt'] },
  'C3-A': Object.fromEntries(
    ['find', 'choose', 'show'].map((v) => [
      v,
      ['$color', '$shapeTarget', `common.${v}`],
    ]),
  ),
  'C3-B': Object.fromEntries(
    ['find', 'choose', 'show'].map((v) => [
      v,
      ['$size', '$color', '$shapeTarget', `common.${v}`],
    ]),
  ),
  C4: { next: ['colors.sequence.prompt'] },
  A2: Object.fromEntries(
    ['bird', 'domestic', 'wild', 'canFly'].map((v) => [
      v,
      [`animals.trait.${v}`],
    ]),
  ),
  A3: { silhouette: ['animals.silhouette.prompt'] },
  'N1-B': Object.fromEntries(
    ['howMany', 'countHowMany'].map((v) => [
      v,
      [`common.${v}`, '$countObject', 'common.has'],
    ]),
  ),
  'N1-C': {
    whichIn: ['common.whichIn', '$number', '$countObject', 'common.has'],
    ...Object.fromEntries(
      ['find', 'choose', 'show'].map((v) => [
        v,
        ['$number', '$countObject', 'common.with', `common.${v}`],
      ]),
    ),
  },
  N2: { more: ['numbers.more.prompt'], less: ['numbers.less.prompt'] },
  'N3-A': Object.fromEntries(
    ['totalHowMany', 'countTotalHowMany'].map((v) => [
      v,
      [`common.${v}`, '$countObject'],
    ]),
  ),
  'N3-B': Object.fromEntries(
    ['howMany', 'countHowMany'].map((v) => [
      v,
      [`common.${v}`, '$countObject', 'common.left'],
    ]),
  ),
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function ids(actual: readonly string[], expected: readonly string[]) {
  check(
    actual.length === expected.length &&
      new Set(actual).size === actual.length &&
      expected.every((x) => actual.includes(x)),
    'Неверный состав старшего каталога',
  );
}
export function validateSeniorContent(content: ContentV2) {
  const clips = new Map(content.audio.map((x) => [x.id, x]));
  ids(
    content.shapes.map((x) => x.id),
    ['circle', 'square', 'triangle', 'rectangle', 'oval', 'star'],
  );
  for (const shape of content.shapes)
    check(
      shape.countObjectId === `shape-${shape.id}` &&
        content.countObjects.some(
          (x) => x.id === shape.countObjectId && x.kind === 'tinted',
        ) &&
        shape.targetClipId === `shape.${shape.id}.target` &&
        clips.has(shape.targetClipId),
      'Неверная форма',
    );
  ids(
    content.sizes.map((x) => x.id),
    ['big', 'small'],
  );
  for (const size of content.sizes)
    check(
      size.labelClipId === `size.${size.id}` &&
        clips.get(size.labelClipId)?.textTt === size.labelTt,
      'Неверный размер',
    );
  for (const [kind, expected] of Object.entries(seniorRecipeParts)) {
    const recipes = content.recipes[kind as keyof typeof content.recipes];
    ids(
      recipes.map((x) => x.id),
      Object.keys(expected),
    );
    for (const recipe of recipes) {
      check(
        JSON.stringify(recipe.parts) === JSON.stringify(expected[recipe.id]),
        `Рецепт ${kind}/${recipe.id}`,
      );
      check(
        recipe.ending ===
          (['find', 'choose', 'show', 'next'].includes(recipe.id) ? '.' : '?'),
        `Знак ${kind}/${recipe.id}`,
      );
      for (const part of recipe.parts)
        check(
          part.startsWith('$') || clips.has(part),
          `Неизвестный клип ${part}`,
        );
    }
  }
  const traits = content.animalTraits;
  const animalIds = content.animals.map((x) => x.id);
  ids(
    traits.animals.map((x) => x.animalId),
    animalIds,
  );
  ids(
    traits.traits.map((x) => x.id),
    ['bird', 'domestic', 'wild', 'canFly', 'canSwim'],
  );
  const sources = traits.sources.map((x) => x.id);
  check(new Set(sources).size === sources.length, 'Дубликат источника');
  for (const animal of traits.animals) {
    for (const [id, value] of Object.entries(animal.values))
      if (value === 'exclude')
        check(
          animal.exclusions[id as keyof typeof animal.values],
          'Исключение без причины',
        );
    check(
      animal.sourceIds.every((x) => sources.includes(x)),
      'Неизвестный источник',
    );
  }
  for (const trait of traits.traits) {
    check(
      trait.clipId === `animals.trait.${trait.id}` && clips.has(trait.clipId),
      'Клип признака',
    );
    check(
      trait.generation === (trait.id === 'canSwim' ? 'disabled' : 'enabled'),
      'Неверный набор активных вопросов',
    );
    if (trait.generation === 'enabled')
      check(
        traits.animals.some((x) => x.values[trait.id] === 'yes') &&
          traits.animals.filter((x) => x.values[trait.id] === 'no').length >= 5,
        'Недостаточно однозначных вариантов A2',
      );
  }
  const silhouettes = content.silhouetteConflicts;
  ids(
    silhouettes.animals.map((x) => x.animalId),
    animalIds,
  );
  for (const animal of silhouettes.animals)
    check(
      graphics.find((x) => x.id === animal.animalId)?.sha256 ===
        animal.masterSha256,
      'Изменился мастер силуэта',
    );
  const forbidden = new Set<string>();
  for (const {
    animalIds: [a, b],
  } of silhouettes.pairs) {
    const key = silhouettePairKey(a, b);
    check(
      a !== b &&
        animalIds.includes(a) &&
        animalIds.includes(b) &&
        !forbidden.has(key),
      'Неверная пара силуэтов',
    );
    forbidden.add(key);
  }
  for (const target of animalIds)
    check(
      findCompatibleAnimals(target, 6, animalIds, forbidden),
      `Невозможный набор A3: ${target}`,
    );
}

export async function validateReviewedGraphics(
  root: string,
  content: ContentV2,
) {
  for (const review of content.silhouetteConflicts.animals) {
    const animal = content.animals.find((x) => x.id === review.animalId)!;
    const bytes = await readGenerated(join(root, 'public'), animal.image);
    check(
      createHash('sha256').update(bytes).digest('hex') === review.webpSha256,
      `Изменился ресурс силуэта: ${animal.id}`,
    );
  }
}
