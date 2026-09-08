import type { GameCategory, Round } from '../../domain/game/models.ts';
import { createRoundGenerator } from '../../domain/game/rounds.ts';
import { createExerciseGenerator } from '../../domain/game/exercises.ts';
import type { AnswerCount } from '../../domain/game/exercise.ts';
import type { CategoryId, ContentV2 } from '../../content/types.ts';

export function createSessionRounds(
  sessionId: string,
  category: GameCategory,
  random: () => number,
) {
  const generate = createRoundGenerator(category, random);
  return createSequence(sessionId, generate, (round: Round) => round.id);
}

export function createSessionExercises(
  sessionId: string,
  content: ContentV2,
  categoryId: CategoryId,
  random: () => number,
) {
  return createSequence(
    sessionId,
    createExerciseGenerator(content, categoryId, random),
    (exercise) => exercise.id,
  );
}

function createSequence<T>(
  sessionId: string,
  generate: (count: AnswerCount) => T,
  identify: (round: T) => number,
) {
  let prepared: T | null = null;
  let preparedCount: AnswerCount = 2;
  let acceptedId = 0;
  return {
    sessionId,
    get(roundId: number, count: AnswerCount = 2): T {
      if (prepared && identify(prepared) === roundId && preparedCount === count)
        return prepared;
      if (prepared || roundId !== acceptedId + 1)
        throw new Error('Нарушен порядок подготовки раундов.');
      prepared = generate(count);
      preparedCount = count;
      return prepared;
    },
    accept(roundId: number) {
      if (prepared && identify(prepared) === roundId) {
        acceptedId = roundId;
        prepared = null;
      }
    },
  };
}

export type SessionRounds = ReturnType<typeof createSessionRounds>;
