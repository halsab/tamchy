import type { ExerciseKind, SeniorAnswerCount } from './exercise.ts';
import type { JuniorAdaptation } from './adaptation.ts';
export type SeniorAdaptation = Readonly<{
  answerCount: SeniorAnswerCount;
  correctCount: number;
  streak: JuniorAdaptation['streak'];
}>;
export function initialSeniorAdaptation(): SeniorAdaptation {
  return { answerCount: 4, correctCount: 0, streak: null };
}
export function recordSeniorResult(
  state: SeniorAdaptation,
  hadMistakes: boolean,
  exerciseKind: ExerciseKind,
): SeniorAdaptation {
  const correctCount = state.correctCount + 1;
  if (exerciseKind === 'N2') return { ...state, correctCount };
  const kind = hadMistakes ? 'mistake' : 'clean';
  const threshold = hadMistakes ? 2 : state.answerCount === 4 ? 4 : 5;
  const count = Math.min(
    threshold,
    state.streak?.kind === kind ? state.streak.count + 1 : 1,
  );
  const answerCount: SeniorAnswerCount =
    count < threshold
      ? state.answerCount
      : hadMistakes
        ? state.answerCount === 6
          ? 5
          : 4
        : state.answerCount === 4
          ? 5
          : 6;
  return {
    answerCount,
    correctCount,
    streak: answerCount === state.answerCount ? { kind, count } : null,
  };
}
