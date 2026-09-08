import type { AudioRecipe, ContentV2 } from '../../content/types.ts';
import type { SpokenPrompt } from './exercise.ts';

export function resolveRecipe(
  content: ContentV2,
  recipe: AudioRecipe,
  bindings: Readonly<Record<string, string>>,
): SpokenPrompt {
  if (!recipe.parts.length) throw new Error('Пустой аудиорецепт.');
  const clipIds = recipe.parts.map((part) => bindings[part] ?? part);
  const textTt =
    clipIds
      .map((id, index) => {
        const clip = content.audio.find((x) => x.id === id);
        if (!clip) throw new Error(`Неизвестный клип ${id}`);
        const word = clip.textTt.replace(/[.?!]+$/u, '');
        return index === 0 ? word : word.toLowerCase();
      })
      .join(' ') + recipe.ending;
  return { kind: 'spoken', textTt, audio: { type: 'sequence', clipIds } };
}
