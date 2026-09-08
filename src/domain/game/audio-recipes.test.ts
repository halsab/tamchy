import { expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import { resolveRecipe } from './audio-recipes.ts';

it('собирает составной признак и сохраняет внутреннее предложение числового задания', () => {
  expect(
    resolveRecipe(contentV2, contentV2.recipes['C3-B'][0]!, {
      $size: 'size.big',
      $color: 'color.red',
      $shapeTarget: 'shape.circle.target',
    }).textTt,
  ).toBe('Зур кызыл түгәрәкне тап.');
  expect(
    resolveRecipe(contentV2, contentV2.recipes['N1-B'][1]!, {
      $countObject: 'count.apple',
    }).textTt,
  ).toBe('Санап кара. Ничә алма бар?');
});
it('не подменяет неизвестный клип или незаполненное место и отклоняет пустую фразу', () => {
  for (const parts of [[], ['missing'], ['$color']])
    expect(() =>
      resolveRecipe(contentV2, { id: 'test', parts, ending: '.' }, {}),
    ).toThrow();
});
