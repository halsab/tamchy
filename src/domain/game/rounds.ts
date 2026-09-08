import type { GameCategory } from './models.ts';
import type { AnswerCount } from './exercise.ts';
import { createExerciseGenerator } from './exercises.ts';

export function createRoundGenerator(
  category: GameCategory,
  random: () => number,
) {
  const generate = createExerciseGenerator(
    category.content,
    category.id,
    random,
  );
  return (count: AnswerCount = 2) => generate(count);
}
