import { exerciseDefinitions } from './exercise.ts';
import type { CategoryId, ContentV2 } from '../../content/types.ts';
import type { TraitId } from '../../content/types.ts';
import type {
  Difficulty,
  ExerciseKind,
  SeniorAnswerCount,
  SequencePattern,
} from './exercise.ts';
import { createShuffledCycle, randomIndex } from './random.ts';

const kinds = Object.entries(exerciseDefinitions).map(([kind, definition]) => ({
  kind: kind as ExerciseKind,
  ...definition,
}));
export function allowedSeniorKinds(
  category: CategoryId,
  correctCount: number,
  recent: readonly ExerciseKind[],
) {
  const available = kinds.filter(
    (x) =>
      x.categoryId === category &&
      x.difficulty <= (correctCount >= 8 ? 3 : correctCount >= 3 ? 2 : 1),
  );
  const previous = recent.at(-1);
  return available.length > 1 &&
    recent.length >= 2 &&
    previous === recent.at(-2)
    ? available.filter((x) => x.kind !== previous)
    : available;
}
export type SeniorPlanRequest = Readonly<{
  roundId: number;
  optionCount: SeniorAnswerCount;
  correctCount: number;
  recentKinds: readonly ExerciseKind[];
}>;
type PlanBase = Readonly<{
  roundId: number;
  optionCount: SeniorAnswerCount;
  difficulty: Difficulty;
}>;
export type SeniorRoundPlan =
  | (PlanBase &
      (
        | Readonly<{
            kind: 'C1' | 'A1' | 'N1-A';
            targetId: string;
            recipeId: string;
          }>
        | Readonly<{
            kind: 'N1-B' | 'N1-C';
            value: number;
            countObjectId: string;
            recipeId: string;
          }>
        | Readonly<{
            kind: 'N3-A' | 'N3-B';
            countObjectId: string;
            recipeId: string;
          }>
        | Readonly<{ kind: 'C2' | 'C3-A' | 'C3-B' | 'A3' }>
        | Readonly<{ kind: 'C4'; pattern: SequencePattern }>
        | Readonly<{ kind: 'A2'; traitId: TraitId }>
      ))
  | Readonly<{
      roundId: number;
      optionCount: 2;
      difficulty: 2;
      kind: 'N2';
      direction: 'more' | 'less';
      left: number;
      right: number;
      countObjectId: string;
    }>;

export function createSeniorPlanner(
  content: ContentV2,
  category: CategoryId,
  random: () => number,
) {
  const cycle = <T>(values: readonly T[]) =>
    createShuffledCycle(values, random);
  const targets = {
    C1: cycle(content.colors.map((x) => x.id)),
    A1: cycle(content.animals.map((x) => x.id)),
    'N1-A': cycle(content.numbers.map((x) => x.id)),
  };
  const quantities = {
    'N1-B': cycle(
      content.numbers.filter((x) => x.value <= 10).map((x) => x.value),
    ),
    'N1-C': cycle(
      content.numbers.filter((x) => x.value <= 10).map((x) => x.value),
    ),
  };
  const objects = cycle(content.countObjects.map((x) => x.id));
  const patterns = cycle<SequencePattern>(['ABAB', 'AABAAB', 'ABCABC']);
  const traits = cycle(
    content.animalTraits.traits
      .filter((x) => x.generation === 'enabled')
      .map((x) => x.id),
  );
  const comparisons = cycle<'more' | 'less'>(['more', 'less']);
  const formulations = new Map<string, () => string>();
  function recipe(kind: ExerciseKind, target: string) {
    const key = `${kind}:${target}`;
    let next = formulations.get(key);
    if (!next) {
      next = cycle(content.recipes[kind].map((x) => x.id));
      formulations.set(key, next);
    }
    return next();
  }
  let accepted = 0;
  let prepared: { key: string; plan: SeniorRoundPlan } | null = null;
  function select(request: SeniorPlanRequest): SeniorRoundPlan {
    const allowed = allowedSeniorKinds(
      category,
      request.correctCount,
      request.recentKinds,
    );
    const levels = ([1, 2, 3] as const).filter((level) =>
      allowed.some((x) => x.difficulty === level),
    );
    const weights = { 1: 40, 2: 35, 3: 25 };
    let draw = randomIndex(
      levels.reduce((sum, level) => sum + weights[level], 0),
      random,
    );
    let difficulty = levels[0]!;
    for (const level of levels) {
      difficulty = level;
      if (draw < weights[level]) break;
      draw -= weights[level];
    }
    const pool = allowed.filter((x) => x.difficulty === difficulty);
    const kind = pool[randomIndex(pool.length, random)]!.kind;
    const base = {
      roundId: request.roundId,
      optionCount: request.optionCount,
      difficulty,
    };
    switch (kind) {
      case 'C1':
      case 'A1':
      case 'N1-A': {
        const targetId = targets[kind]();
        return { ...base, kind, targetId, recipeId: recipe(kind, targetId) };
      }
      case 'N1-B':
      case 'N1-C': {
        const value = quantities[kind]();
        return {
          ...base,
          kind,
          value,
          countObjectId: objects(),
          recipeId: recipe(kind, String(value)),
        };
      }
      case 'N3-A':
      case 'N3-B':
        return {
          ...base,
          kind,
          countObjectId: objects(),
          recipeId: recipe(kind, ''),
        };
      case 'C4':
        return { ...base, kind, pattern: patterns() };
      case 'A2':
        return { ...base, kind, traitId: traits() };
      case 'N2': {
        const near = request.correctCount >= 8 && randomIndex(3, random) < 2;
        const difference = (near ? 1 : 4) + randomIndex(3, random);
        const smaller = 1 + randomIndex(10 - difference, random),
          larger = smaller + difference;
        const swap = randomIndex(2, random) === 1;
        return {
          roundId: request.roundId,
          kind,
          optionCount: 2,
          difficulty: 2,
          direction: comparisons(),
          left: swap ? larger : smaller,
          right: swap ? smaller : larger,
          countObjectId: objects(),
        };
      }
      case 'C2':
      case 'C3-A':
      case 'C3-B':
      case 'A3':
        return { ...base, kind };
    }
  }
  return {
    get(request: SeniorPlanRequest): SeniorRoundPlan {
      if (
        !Number.isSafeInteger(request.roundId) ||
        request.roundId < 1 ||
        !Number.isSafeInteger(request.correctCount) ||
        request.correctCount < 0 ||
        ![4, 5, 6].includes(request.optionCount) ||
        request.recentKinds.length > 2 ||
        request.recentKinds.some(
          (kind) =>
            !kinds.some((x) => x.categoryId === category && x.kind === kind),
        )
      )
        throw new Error('Недопустимый запрос старшего раунда.');
      const key = JSON.stringify([
        request.roundId,
        request.optionCount,
        request.correctCount,
        request.recentKinds,
      ]);
      if (prepared?.key === key) return prepared.plan;
      if (prepared || request.roundId !== accepted + 1)
        throw new Error('Нарушен порядок подготовки старших раундов.');
      const plan = Object.freeze(select(request));
      prepared = { key, plan };
      return plan;
    },
    accept(roundId: number) {
      if (prepared?.plan.roundId === roundId) {
        accepted = roundId;
        prepared = null;
      }
    },
  };
}
