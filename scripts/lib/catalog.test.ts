import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../../src/content/catalog.json' with { type: 'json' };
import strings from '../../src/content/tt.json' with { type: 'json' };
import { parseCatalog, parseStrings } from './catalog.ts';

function changeItem(id: string, changes: Record<string, unknown>) {
  const copy = structuredClone(data);
  const item = copy.categories
    .flatMap<Record<string, unknown>>((category) => category.items)
    .find((item) => item.id === id)!;
  Object.assign(item, changes);
  return copy;
}

describe('каталог MVP', () => {
  it('принимает три раздела и 15 элементов из ТЗ', () => {
    const catalog = parseCatalog(data);
    expect(catalog.categories.map(({ id }) => id)).toEqual([
      'colors',
      'animals',
      'numbers',
    ]);
    expect(catalog.categories.map(({ items }) => items.length)).toEqual([
      4, 6, 5,
    ]);
    expect(parseStrings(strings)).toEqual(strings);
  });

  it('сохраняет точные названия и полные задания приложения A', () => {
    const specification = readFileSync(
      new URL('../../docs/specification.md', import.meta.url),
      'utf8',
    );
    const rows = [
      ...specification.matchAll(
        /^\| ((?:color|animal|number)-[^ |]+) \| ([^|]+) \| ([^|]+) \|$/gm,
      ),
    ];
    const items = parseCatalog(data).categories.flatMap(({ items }) => items);
    expect(rows).toHaveLength(15);
    for (const [, id, label, prompt] of rows) {
      expect(items.find((item) => item.id === id)).toMatchObject({
        labelTt: label!.trim(),
        promptTt: prompt!.trim(),
      });
    }
  });

  it.each([
    ['дубликат ID', 'color-red', { id: 'color-blue' }],
    ['неизвестный ID', 'animal-cat', { id: 'animal-fox' }],
    ['тип другого раздела', 'color-red', { kind: 'animal' }],
    ['лишнее специализированное поле', 'color-red', { value: 1 }],
    ['отсутствующее поле', 'animal-cat', { image: undefined }],
    ['неверный цвет', 'color-red', { hex: '#FF0000' }],
    ['цвет другого элемента', 'color-red', { hex: '#347FD4' }],
    ['число вне диапазона', 'number-1', { value: 6 }],
    ['дробное число', 'number-1', { value: 1.5 }],
    ['число другого элемента', 'number-1', { value: 2 }],
    ['число строкой', 'number-1', { value: '1' }],
    ['пустая строка', 'animal-cat', { promptTt: ' ' }],
    [
      'чужая иллюстрация',
      'animal-cat',
      { image: 'assets/images/animals/animal-dog.webp' },
    ],
    [
      'отложенная реплика',
      'color-red',
      { labelAudio: 'assets/audio/tt/interaction/hello.mp3' },
    ],
    [
      'подмена названия заданием',
      'color-red',
      { labelAudio: 'assets/audio/tt/colors/color-red-prompt.mp3' },
    ],
  ])('отклоняет: %s', (_, id, changes) => {
    expect(() => parseCatalog(changeItem(id, changes))).toThrow();
  });

  it.each([
    '/assets/a.mp3',
    'https://example.com/a.mp3',
    '//example.com/a.mp3',
    '../a.mp3',
    'assets/../a.mp3',
    'assets/%2e%2e/a.mp3',
    'assets\\audio\\a.mp3',
    'public/assets/a.mp3',
    'dist/a.mp3',
    'assets-source/a.png',
    'assets/audio/tt/colors/Color-red-label.mp3',
    'assets/audio/tt/colors/color-red-label.mp3?x=1',
  ])('отклоняет путь %s', (path) => {
    expect(() =>
      parseCatalog(changeItem('color-red', { labelAudio: path })),
    ).toThrow();
  });

  it('отклоняет неполный набор, неизвестный раздел и перестановку разделов', () => {
    const missing = structuredClone(data);
    missing.categories[0]!.items.pop();
    expect(() => parseCatalog(missing)).toThrow();
    const unknown = structuredClone(data);
    unknown.categories[0]!.id = 'other';
    expect(() => parseCatalog(unknown)).toThrow();
    expect(() =>
      parseCatalog({ categories: [...data.categories].reverse() }),
    ).toThrow();
  });

  it('отклоняет недостающие строки интерфейса', () => {
    expect(() => parseStrings({ ...strings, app: {} })).toThrow();
    expect(() =>
      parseStrings({ ...strings, action: { ...strings.action, retry: '' } }),
    ).toThrow();
  });
});
