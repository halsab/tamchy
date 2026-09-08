import type { JuniorAnswerCount } from './exercise.ts';

export type JuniorAdaptation = Readonly<{
  answerCount: JuniorAnswerCount;
  streak: Readonly<{ kind: 'clean' | 'mistake'; count: number }> | null;
}>;
export const juniorBalance = { advanceAfter: 5, reduceAfter: 2 } as const;

export function initialAdaptation(): JuniorAdaptation {
  return { answerCount: 2, streak: null };
}

export function recordRoundResult(
  state: JuniorAdaptation,
  hadMistakes: boolean,
): JuniorAdaptation {
  const kind = hadMistakes ? 'mistake' : 'clean';
  const count = state.streak?.kind === kind ? state.streak.count + 1 : 1;
  const threshold = hadMistakes
    ? juniorBalance.reduceAfter
    : juniorBalance.advanceAfter;
  if (count < threshold)
    return { answerCount: state.answerCount, streak: { kind, count } };
  const answerCount = hadMistakes
    ? state.answerCount === 4
      ? 3
      : 2
    : state.answerCount === 2
      ? 3
      : 4;
  return { answerCount, streak: null };
}
