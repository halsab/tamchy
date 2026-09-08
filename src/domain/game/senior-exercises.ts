import type { CategoryId, ContentV2 } from '../../content/types.ts';
import { exerciseDefinitions } from './exercise.ts';
import type { SeniorExercise } from './exercise.ts';
import { generateSeniorAnimals } from './senior-animals.ts';
import { generateSeniorColors } from './senior-colors.ts';
import { generateSeniorNumbers } from './senior-numbers.ts';
import { createSeniorPlanner } from './senior-planner.ts';
import type { SeniorPlanRequest, SeniorRoundPlan } from './senior-planner.ts';
import { validExercise } from './validate-exercise.ts';

export function buildSeniorExercise(
  content: ContentV2,
  plan: SeniorRoundPlan,
  random: () => number,
): SeniorExercise {
  if (
    !Number.isSafeInteger(plan.roundId) ||
    plan.roundId < 1 ||
    plan.difficulty !== exerciseDefinitions[plan.kind].difficulty ||
    !(plan.kind === 'N2'
      ? plan.optionCount === 2
      : [4, 5, 6].includes(plan.optionCount))
  )
    throw new Error('Недопустимый план упражнения.');
  let exercise: SeniorExercise;
  switch (plan.kind) {
    case 'C1':
    case 'C2':
    case 'C3-A':
    case 'C3-B':
    case 'C4':
      exercise = generateSeniorColors(content, plan, random);
      break;
    case 'A1':
    case 'A2':
    case 'A3':
      exercise = generateSeniorAnimals(content, plan, random);
      break;
    case 'N1-A':
    case 'N1-B':
    case 'N1-C':
    case 'N2':
    case 'N3-A':
    case 'N3-B':
      exercise = generateSeniorNumbers(content, plan, random);
      break;
  }
  if (
    !validExercise(
      { content, categoryId: exercise.categoryId, mode: 'senior' },
      exercise,
      plan.kind === 'N2' ? 4 : plan.optionCount,
    )
  )
    throw new Error('Не удалось построить допустимое упражнение.');
  return exercise;
}

export function createSeniorExerciseGenerator(
  content: ContentV2,
  category: CategoryId,
  random: () => number,
) {
  const planner = createSeniorPlanner(content, category, random);
  let prepared: SeniorExercise | null = null;
  return {
    get(request: SeniorPlanRequest): SeniorExercise {
      const plan = planner.get(request);
      // План и все помехи живут до принятия: повтор подготовки не расходует случайность и циклы.
      prepared ??= buildSeniorExercise(content, plan, random);
      return prepared;
    },
    accept(roundId: number) {
      if (prepared?.id === roundId) {
        planner.accept(roundId);
        prepared = null;
      }
    },
  };
}
