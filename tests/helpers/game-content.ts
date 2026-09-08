import { contentV2 } from '../../src/content/v2/catalog.ts';
import type { GameCategory } from '../../src/domain/game/models.ts';

export const gameCategories: readonly GameCategory[] = contentV2.categories.map(
  (category) => ({ id: category.id, content: contentV2 }),
);
export function categoryIds(category: GameCategory) {
  return category.id === 'colors'
    ? category.content.colors.map((color) => `color-${color.id}`)
    : category.id === 'animals'
      ? category.content.animals.map((animal) => animal.id)
      : category.content.numbers
          .filter((number) => number.value <= 10)
          .map((number) => number.id);
}
