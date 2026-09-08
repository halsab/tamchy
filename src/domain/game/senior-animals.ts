import type { ContentV2 } from '../../content/types.ts';
import type { SeniorExercise } from './exercise.ts';
import type { SeniorRoundPlan } from './senior-planner.ts';
import {
  byId,
  animalOption,
  confirmation,
  pick,
  speech,
  withDistractors,
} from './senior-generation.ts';
import { shuffle } from './random.ts';
import { findCompatibleAnimals, silhouettePairKey } from './silhouettes.ts';

export function generateSeniorAnimals(
  content: ContentV2,
  plan: SeniorRoundPlan & { kind: 'A1' | 'A2' | 'A3' },
  random: () => number,
): SeniorExercise {
  const base = {
    mode: 'senior' as const,
    id: plan.roundId,
    categoryId: 'animals' as const,
  };
  switch (plan.kind) {
    case 'A1': {
      const target = byId(content.animals, plan.targetId);
      return {
        ...base,
        kind: 'A1',
        difficulty: 1,
        prompt: speech(content, 'A1', plan.recipeId, {
          $label: target.labelClipId,
          $target: target.targetClipId,
        }),
        options: withDistractors(
          target,
          content.animals,
          plan.optionCount,
          random,
        ).map(animalOption),
        correctOptionId: target.id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'A2': {
      const trait = byId(content.animalTraits.traits, plan.traitId);
      if (trait.generation !== 'enabled')
        throw new Error('Вопрос по признаку отключён.');
      const pool = (value: 'yes' | 'no') =>
        content.animalTraits.animals
          .filter((x) => x.values[trait.id] === value)
          .map((x) => byId(content.animals, x.animalId));
      const target = pick(pool('yes'), random);
      return {
        ...base,
        kind: 'A2',
        difficulty: 2,
        prompt: {
          ...speech(content, 'A2', trait.id),
          kind: 'trait',
          traitId: trait.id,
        },
        options: withDistractors(
          target,
          pool('no'),
          plan.optionCount,
          random,
        ).map(animalOption),
        correctOptionId: target.id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'A3': {
      const target = pick(content.animals, random);
      const forbidden = new Set(
        content.silhouetteConflicts.pairs.map((x) =>
          silhouettePairKey(...x.animalIds),
        ),
      );
      const ids = findCompatibleAnimals(
        target.id,
        plan.optionCount,
        shuffle(
          content.animals.map((x) => x.id),
          random,
        ),
        forbidden,
      );
      if (!ids)
        throw new Error('Невозможно составить однозначный набор силуэтов.');
      return {
        ...base,
        kind: 'A3',
        difficulty: 2,
        prompt: {
          ...speech(content, 'A3', content.recipes.A3[0]!.id),
          kind: 'silhouette',
          animalId: target.id,
          image: target.image,
        },
        options: shuffle(ids, random).map((id) =>
          animalOption(byId(content.animals, id)),
        ),
        correctOptionId: target.id,
        confirmation: confirmation(target.labelClipId),
      };
    }
  }
}
