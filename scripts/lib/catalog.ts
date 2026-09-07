import { z } from 'zod';
import type { Catalog } from '../../src/content/types.ts';
import { isAssetPath } from '../../src/services/assets/paths.ts';

const text = z.string().trim().min(1);
const resourcePath = z
  .string()
  .refine(isAssetPath, 'Недопустимый относительный путь ресурса');
const common = {
  id: z.string().regex(/^[a-z]+-[a-z0-9]+$/),
  labelTt: text,
  promptTt: text,
  labelAudio: resourcePath,
  promptAudio: resourcePath,
};

const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('color'),
    hex: z.string().regex(/^#[0-9A-F]{6}$/),
  }),
  z.strictObject({ ...common, kind: z.literal('animal'), image: resourcePath }),
  z.strictObject({
    ...common,
    kind: z.literal('number'),
    value: z.number().int().min(1).max(5),
    countImage: resourcePath,
  }),
]);

const colors: Record<string, string> = {
  'color-red': '#D94343',
  'color-yellow': '#F3C63A',
  'color-green': '#32965B',
  'color-blue': '#347FD4',
};
const expected = {
  colors: { kind: 'color', label: 'Төсләр', ids: Object.keys(colors) },
  animals: {
    kind: 'animal',
    label: 'Хайваннар',
    ids: [
      'animal-cat',
      'animal-dog',
      'animal-cow',
      'animal-horse',
      'animal-sheep',
      'animal-duck',
    ],
  },
  numbers: {
    kind: 'number',
    label: 'Саннар',
    ids: [1, 2, 3, 4, 5].map((value) => `number-${value}`),
  },
};

const catalogSchema = z
  .strictObject({
    categories: z
      .array(
        z.strictObject({
          id: z.enum(['colors', 'animals', 'numbers']),
          labelTt: text,
          image: resourcePath,
          items: z.array(itemSchema),
        }),
      )
      .length(3),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    catalog.categories.forEach((category, categoryIndex) => {
      const path = ['categories', categoryIndex];
      const definition = expected[category.id];
      if (category.id !== Object.keys(expected)[categoryIndex])
        issue([...path, 'id'], 'Неверный состав или порядок разделов');
      if (category.labelTt !== definition.label)
        issue([...path, 'labelTt'], 'Название раздела не соответствует ТЗ');
      if (
        category.image !==
        `assets/images/categories/category-${category.id}.webp`
      )
        issue([...path, 'image'], 'Неверная иллюстрация раздела');
      if (
        category.items.length !== definition.ids.length ||
        definition.ids.some(
          (id) => !category.items.some((item) => item.id === id),
        )
      ) {
        issue([...path, 'items'], 'Неполный или неверный состав MVP');
      }
      category.items.forEach((item, itemIndex) => {
        const itemPath = [...path, 'items', itemIndex];
        if (seen.has(item.id))
          issue([...itemPath, 'id'], `Дубликат ID: ${item.id}`);
        seen.add(item.id);
        if (!definition.ids.includes(item.id) || item.kind !== definition.kind)
          issue(itemPath, 'Элемент не принадлежит разделу');
        for (const role of ['label', 'prompt'] as const) {
          if (
            item[`${role}Audio`] !==
            `assets/audio/tt/${category.id}/${item.id}-${role}.mp3`
          )
            issue(
              [...itemPath, `${role}Audio`],
              'Путь учебной записи не соответствует ID и назначению',
            );
        }
        if (item.kind === 'color' && item.hex !== colors[item.id])
          issue([...itemPath, 'hex'], 'Учебный цвет не соответствует ТЗ');
        if (
          item.kind === 'animal' &&
          item.image !== `assets/images/animals/${item.id}.webp`
        )
          issue(
            [...itemPath, 'image'],
            'Иллюстрация не соответствует животному',
          );
        if (item.kind === 'number') {
          if (item.id !== `number-${item.value}`)
            issue([...itemPath, 'value'], 'Число не соответствует ID');
          if (item.countImage !== 'assets/images/numbers/count-apple.webp')
            issue(
              [...itemPath, 'countImage'],
              'Для счёта используется одно яблоко',
            );
        }
      });
    });
  }) satisfies z.ZodType<Catalog>;

const stringsSchema = z.strictObject({
  app: z.strictObject({ name: z.literal('Тамчы') }),
  nav: z.strictObject({ home: text, parents: text }),
  action: z.strictObject({
    listen: text,
    listenAgain: text,
    continue: text,
    retry: text,
  }),
  status: z.strictObject({ loading: text, offlineReady: text }),
  error: z.strictObject({ load: text, audio: text }),
  game: z.strictObject({
    answers: text,
    correct: text,
    hint: text,
    tryAgain: text,
    activate: text,
    paused: text,
  }),
  pwa: z.strictObject({
    preparing: text,
    error: text,
    unsupported: text,
    cleared: text,
    installTitle: text,
    ios: text,
    android: text,
    installAction: text,
    installed: text,
    updateTitle: text,
    updateNone: text,
    updatePreparing: text,
    updateWaiting: text,
    updateError: text,
  }),
  parents: z.strictObject({
    about: text,
    connectionTitle: text,
    connection: text,
    dataTitle: text,
    data: text,
    hosting: text,
    materialsTitle: text,
    materials: text,
    version: text,
  }),
});

export function parseCatalog(input: unknown): Catalog {
  return catalogSchema.parse(input);
}

export function parseStrings(input: unknown) {
  return stringsSchema.parse(input);
}
