import type { GameCategory, Round } from '../../domain/game/models.ts';
import { createRoundGenerator } from '../../domain/game/rounds.ts';
import { createExerciseGenerator } from '../../domain/game/exercises.ts';
import type { AnswerCount } from '../../domain/game/exercise.ts';
import type { CategoryId, ContentV2 } from '../../content/types.ts';
import { createSeniorExerciseGenerator } from '../../domain/game/senior-exercises.ts';
import type { SeniorPlanRequest } from '../../domain/game/senior-planner.ts';

type Planning = Pick<SeniorPlanRequest, 'correctCount' | 'recentKinds'>;
export type SessionRounds = {
  sessionId: string;
  get: (roundId: number, count?: AnswerCount, planning?: Planning) => Round;
  accept: (roundId: number) => void;
};

export function createSessionRounds(
  sessionId: string,
  category: GameCategory,
  random: () => number,
): SessionRounds {
  if (category.mode === 'senior') {
    const generator = createSeniorExerciseGenerator(
      category.content,
      category.id,
      random,
    );
    return {
      sessionId,
      get(roundId, count = 4, planning) {
        if (![4, 5, 6].includes(count) || (!planning && roundId !== 1))
          throw new Error(
            'Старшему раунду нужны актуальная адаптация и история видов.',
          );
        return generator.get({
          roundId,
          optionCount: count as 4 | 5 | 6,
          ...(planning ?? { correctCount: 0, recentKinds: [] }),
        });
      },
      accept: generator.accept,
    };
  }
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
