import type { ContentV2 } from '../../content/types.ts';
import type { GroupOption, SeniorExercise } from './exercise.ts';
import type { SeniorRoundPlan } from './senior-planner.ts';
import {
  byId,
  confirmation,
  countIllustration,
  numberOption,
  speech,
} from './senior-generation.ts';
import { randomIndex, shuffle } from './random.ts';

export function generateSeniorNumbers(
  content: ContentV2,
  plan: SeniorRoundPlan & {
    kind: 'N1-A' | 'N1-B' | 'N1-C' | 'N2' | 'N3-A' | 'N3-B';
  },
  random: () => number,
): SeniorExercise {
  const base = {
    mode: 'senior' as const,
    id: plan.roundId,
    categoryId: 'numbers' as const,
  };
  const number = (value: number) => {
    const found = content.numbers.find((x) => x.value === value);
    if (!found) throw new Error('Число отсутствует в каталоге.');
    return found;
  };
  function options(value: number, max = 10) {
    const target = number(value);
    // Предварительное перемешивание делает равные расстояния равноправными; позиция ответа выбирается отдельно.
    const distractors = shuffle(
      content.numbers.filter((x) => x.value <= max && x.value !== value),
      random,
    ).sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value));
    return shuffle(
      [target, ...distractors.slice(0, plan.optionCount - 1)],
      random,
    ).map(numberOption);
  }
  switch (plan.kind) {
    case 'N1-A': {
      const target = byId(content.numbers, plan.targetId);
      return {
        ...base,
        kind: 'N1-A',
        difficulty: 1,
        prompt: speech(content, plan.kind, plan.recipeId, {
          $label: target.labelClipId,
          $target: target.targetClipId,
        }),
        options: options(target.value, 20),
        correctOptionId: target.id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'N1-B':
    case 'N1-C':
    case 'N2':
    case 'N3-A':
    case 'N3-B': {
      const object = byId(content.countObjects, plan.countObjectId);
      const illustration = countIllustration(content, object.id, random);
      const bindings = { $countObject: object.labelClipId };
      const group = (value: number): GroupOption => ({
        kind: 'group',
        id: `group-${value}`,
        value,
        labelTt: `${number(value).labelTt} ${object.labelTt.toLowerCase()}`,
      });
      if (plan.kind === 'N2') {
        const value =
          plan.direction === 'more'
            ? Math.max(plan.left, plan.right)
            : Math.min(plan.left, plan.right);
        return {
          ...base,
          kind: 'N2',
          difficulty: 2,
          prompt: {
            ...speech(content, plan.kind, plan.direction),
            kind: 'comparison',
            direction: plan.direction,
          },
          countObject: illustration,
          options: [group(plan.left), group(plan.right)],
          correctOptionId: group(value).id,
          confirmation: confirmation(number(value).labelClipId),
        };
      }
      if (plan.kind === 'N1-C') {
        const target = number(plan.value);
        return {
          ...base,
          kind: 'N1-C',
          difficulty: 1,
          prompt: {
            ...speech(content, plan.kind, plan.recipeId, {
              ...bindings,
              $number: target.labelClipId,
            }),
            kind: 'numeral',
            value: plan.value,
          },
          countObject: illustration,
          options: options(plan.value).map((x) => group(x.value)),
          correctOptionId: group(plan.value).id,
          confirmation: confirmation(target.labelClipId),
        };
      }
      const prompt = speech(content, plan.kind, plan.recipeId, bindings);
      if (plan.kind === 'N1-B')
        return {
          ...base,
          kind: 'N1-B',
          difficulty: 1,
          prompt: {
            ...prompt,
            kind: 'quantity',
            value: plan.value,
            countObject: illustration,
          },
          options: options(plan.value),
          correctOptionId: number(plan.value).id,
          confirmation: confirmation(number(plan.value).labelClipId),
        };
      const total = 2 + randomIndex(9, random),
        part = 1 + randomIndex(total - 1, random);
      const value = plan.kind === 'N3-A' ? total : total - part;
      const result = {
        ...base,
        difficulty: 3 as const,
        options: options(value),
        correctOptionId: number(value).id,
        confirmation: confirmation(number(value).labelClipId),
      };
      return plan.kind === 'N3-A'
        ? {
            ...result,
            kind: 'N3-A',
            prompt: {
              ...prompt,
              kind: 'addition',
              left: part,
              right: total - part,
              countObject: illustration,
            },
          }
        : {
            ...result,
            kind: 'N3-B',
            prompt: {
              ...prompt,
              kind: 'subtraction',
              total,
              removed: part,
              countObject: illustration,
            },
          };
    }
  }
}
