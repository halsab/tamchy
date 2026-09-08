import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ContentV2 } from '../../src/content/v2/types.ts';
import graphics from '../../src/content/v2/graphics.json' with { type: 'json' };
import { isAssetPath } from '../../src/services/assets/paths.ts';
import {
  interactionIds,
  interactionPath,
} from '../../src/content/interactions.ts';

const text = z.string().trim().min(1);
const path = text.refine(isAssetPath, 'Недопустимый путь ресурса');
const label = { id: text, labelTt: text, labelClipId: text };
const recipe = z.strictObject({
  id: text,
  parts: z.array(text).min(1),
  ending: z.enum(['.', '?']),
});
const schema = z.strictObject({
  categories: z
    .array(
      z.strictObject({
        id: z.enum(['colors', 'animals', 'numbers']),
        labelTt: text,
        image: path,
      }),
    )
    .length(3),
  colors: z
    .array(
      z.strictObject({ ...label, hex: z.string().regex(/^#[0-9A-F]{6}$/) }),
    )
    .length(13),
  animals: z
    .array(z.strictObject({ ...label, targetClipId: text, image: path }))
    .length(39),
  numbers: z
    .array(
      z.strictObject({
        ...label,
        targetClipId: text,
        value: z.number().int().min(1).max(20),
      }),
    )
    .length(20),
  countObjects: z
    .array(
      z.strictObject({
        ...label,
        kind: z.enum(['raster', 'tinted']),
        image: path,
      }),
    )
    .length(13),
  audio: z
    .array(
      z.strictObject({ id: text, textTt: text, path, master: text.nullable() }),
    )
    .length(189),
  recipes: z.strictObject({
    C1: z.array(recipe).length(3),
    A1: z.array(recipe).length(5),
    'N1-A': z.array(recipe).length(5),
  }),
});
const palette: Record<string, string> = {
  red: '#D94343',
  orange: '#F28C28',
  yellow: '#F3C63A',
  green: '#32965B',
  turquoise: '#2CAFA5',
  'light-blue': '#4AA8E8',
  blue: '#347FD4',
  purple: '#7959C8',
  pink: '#E66D9A',
  brown: '#8A5A3B',
  gray: '#7D8583',
  white: '#FFFFFF',
  black: '#222625',
};
const objectClips: Record<string, string> = {
  'count-apple': 'count.apple',
  'color-object-ball': 'count.ball',
  'color-object-ring-toy': 'count.ring',
  'color-object-car-toy': 'count.car',
  'color-object-cube': 'shape.square',
  'color-object-pyramid-toy': 'count.pyramid',
  'color-object-top': 'count.top',
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function sameIds(
  actual: readonly string[],
  expected: readonly string[],
  subject: string,
) {
  assert(
    actual.length === expected.length &&
      new Set(actual).size === actual.length &&
      expected.every((id) => actual.includes(id)),
    `Неверный состав ${subject}`,
  );
}

export function parseV2Content(input: unknown): ContentV2 {
  const content = schema.parse(input);
  const clips = new Map(content.audio.map((clip) => [clip.id, clip]));
  assert(
    clips.size === 189 &&
      new Set(content.audio.map((clip) => clip.path)).size === 189,
    'Дубликат аудио',
  );
  for (const clip of content.audio) {
    const expected = clip.id.startsWith('interaction.')
      ? `assets/audio/tt/interaction/${clip.id.slice('interaction.'.length)}.mp3`
      : `assets/audio/tt/clips/${clip.id
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .replaceAll('.', '-')
          .toLowerCase()}.mp3`;
    assert(clip.path === expected, `Путь клипа ${clip.id}`);
  }
  sameIds(
    content.audio.filter((x) => x.master === null).map((x) => x.id),
    interactionIds.map((id) => `interaction.${id}`),
    'интерактивных реплик',
  );
  for (const id of interactionIds)
    assert(
      clips.get(`interaction.${id}`)?.path === interactionPath(id),
      `Реплика ${id}`,
    );
  const categoryIds = ['colors', 'animals', 'numbers'];
  const categoryLabels = ['Төсләр', 'Хайваннар', 'Саннар'];
  content.categories.forEach((category, index) => {
    assert(
      category.id === categoryIds[index] &&
        category.labelTt === categoryLabels[index],
      'Порядок и названия разделов',
    );
    assert(
      category.image ===
        `assets/images/categories/category-${category.id}.webp`,
      'Изображение раздела',
    );
  });
  for (const list of [
    content.colors,
    content.animals,
    content.numbers,
    content.countObjects,
  ]) {
    assert(new Set(list.map((x) => x.id)).size === list.length, 'Дубликат ID');
    for (const item of list)
      assert(
        clips.get(item.labelClipId)?.textTt === item.labelTt,
        `Название ${item.id}`,
      );
  }
  sameIds(
    content.colors.map((x) => x.id),
    Object.keys(palette),
    'цветов',
  );
  for (const color of content.colors)
    assert(
      color.hex === palette[color.id] &&
        color.labelClipId === `color.${color.id}`,
      `Палитра ${color.id}`,
    );
  const animals = graphics.filter((x) => x.id.startsWith('animal-'));
  sameIds(
    content.animals.map((x) => x.id),
    animals.map((x) => x.id),
    'животных',
  );
  for (const animal of content.animals) {
    const clipId = animal.id.replace('animal-', 'animal.');
    assert(
      animal.image === animals.find((x) => x.id === animal.id)?.outputs[0],
      `Изображение ${animal.id}`,
    );
    assert(
      animal.labelClipId === clipId &&
        animal.targetClipId === `${clipId}.target` &&
        clips.has(animal.targetClipId),
      `Словоформа ${animal.id}`,
    );
  }
  sameIds(
    content.numbers.map((x) => x.id),
    Array.from({ length: 20 }, (_, i) => `number-${i + 1}`),
    'чисел',
  );
  for (const number of content.numbers)
    assert(
      number.id === `number-${number.value}` &&
        number.labelClipId === `number.${number.value}` &&
        number.targetClipId === `number.${number.value}.target` &&
        clips.has(number.targetClipId),
      `Число ${number.id}`,
    );
  const objects = graphics.filter(
    (x) => x.id.startsWith('shape-') || Object.hasOwn(objectClips, x.id),
  );
  sameIds(
    content.countObjects.map((x) => x.id),
    objects.map((x) => x.id),
    'счётных объектов',
  );
  for (const object of content.countObjects) {
    assert(
      object.image === objects.find((x) => x.id === object.id)?.outputs[0],
      `Изображение ${object.id}`,
    );
    assert(
      object.labelClipId ===
        (objectClips[object.id] ?? object.id.replace('shape-', 'shape.')),
      `Клип ${object.id}`,
    );
    assert(
      object.kind === (object.id === 'count-apple' ? 'raster' : 'tinted'),
      `Основа ${object.id}`,
    );
  }
  for (const [kind, recipes] of Object.entries(content.recipes)) {
    const verbs =
      kind === 'C1'
        ? ['find', 'choose', 'show']
        : ['where', 'find', 'choose', 'show', 'which'];
    sameIds(
      recipes.map((x) => x.id),
      verbs,
      `формулировок ${kind}`,
    );
    for (const recipe of recipes) {
      const parts =
        kind === 'C1'
          ? ['$label', `colors.${recipe.id}Tail`]
          : recipe.id === 'where'
            ? ['$label', 'common.where']
            : recipe.id === 'which'
              ? ['common.which', '$label']
              : ['$target', `common.${recipe.id}`];
      assert(
        JSON.stringify(recipe.parts) === JSON.stringify(parts),
        `Рецепт ${kind}/${recipe.id}`,
      );
      assert(
        recipe.ending === (['where', 'which'].includes(recipe.id) ? '?' : '.'),
        `Знак ${kind}/${recipe.id}`,
      );
      for (const part of recipe.parts)
        assert(
          part.startsWith('$') || clips.has(part),
          `Неизвестный клип ${part}`,
        );
    }
  }
  return content;
}

export async function readV2Content(root: string): Promise<ContentV2> {
  const entries = await Promise.all(
    Object.entries({
      categories: 'categories',
      colors: 'colors',
      animals: 'animals',
      numbers: 'numbers',
      countObjects: 'count-objects',
      audio: 'audio',
      recipes: 'recipes',
    }).map(async ([key, file]) => [
      key,
      JSON.parse(
        await readFile(join(root, `src/content/v2/${file}.json`), 'utf8'),
      ),
    ]),
  );
  return parseV2Content(Object.fromEntries(entries));
}
