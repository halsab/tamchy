import { contentV2 } from '../../src/content/v2/catalog.ts';
import type { CategoryId } from '../../src/content/types.ts';

export function juniorItems(categoryId: CategoryId) {
  return categoryId === 'colors'
    ? contentV2.colors
    : categoryId === 'animals'
      ? contentV2.animals
      : contentV2.numbers.filter((number) => number.value <= 10);
}

export function juniorPrompts(categoryId: CategoryId) {
  const kind =
    categoryId === 'colors' ? 'C1' : categoryId === 'animals' ? 'A1' : 'N1-A';
  const clips = new Map(contentV2.audio.map((clip) => [clip.id, clip]));
  return juniorItems(categoryId).flatMap((target) =>
    contentV2.recipes[kind].map((recipe) => {
      const parts = recipe.parts.map((part) =>
        clips.get(
          part === '$label'
            ? target.labelClipId
            : part === '$target' && 'targetClipId' in target
              ? target.targetClipId
              : part,
        )!,
      );
      return {
        recipeId: recipe.id,
        target,
        textTt:
          parts
            .map((clip, index) => {
              const word = clip.textTt.replace(/[.?!]+$/u, '');
              return index === 0 ? word : word.toLowerCase();
            })
            .join(' ') + recipe.ending,
        promptAudio: parts.map((clip) => clip.path),
        labelAudio: clips.get(target.labelClipId)!.path,
      };
    }),
  );
}
