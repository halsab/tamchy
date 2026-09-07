import type { GameCategory, Round } from '../../domain/game/models.ts';
import { createRoundGenerator } from '../../domain/game/rounds.ts';

export function createSessionRounds(
  sessionId: string,
  category: GameCategory,
  random: () => number,
) {
  const generate = createRoundGenerator(category, random);
  let prepared: Round | null = null;
  let acceptedId = 0;
  return {
    sessionId,
    get(roundId: number): Round {
      if (prepared?.roundId === roundId) return prepared;
      if (prepared || roundId !== acceptedId + 1)
        throw new Error('Нарушен порядок подготовки раундов.');
      prepared = generate();
      return prepared;
    },
    accept(roundId: number) {
      if (prepared?.roundId === roundId) {
        acceptedId = roundId;
        prepared = null;
      }
    },
  };
}

export type SessionRounds = ReturnType<typeof createSessionRounds>;
