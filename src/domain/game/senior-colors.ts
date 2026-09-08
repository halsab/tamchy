import type { ContentV2 } from '../../content/types.ts';
import type {
  SeniorExercise,
  ShapeOption,
  SizedShapeOption,
} from './exercise.ts';
import type { SeniorRoundPlan } from './senior-planner.ts';
import {
  byId,
  colorOption,
  confirmation,
  pick,
  speech,
  withDistractors,
} from './senior-generation.ts';
import { shuffle } from './random.ts';

export function generateSeniorColors(
  content: ContentV2,
  plan: SeniorRoundPlan & { kind: 'C1' | 'C2' | 'C3-A' | 'C3-B' | 'C4' },
  random: () => number,
): SeniorExercise {
  const base = {
    mode: 'senior' as const,
    id: plan.roundId,
    categoryId: 'colors' as const,
  };
  const options = (target: ContentV2['colors'][number]) =>
    withDistractors(target, content.colors, plan.optionCount, random).map(
      colorOption,
    );
  switch (plan.kind) {
    case 'C1': {
      const target = byId(content.colors, plan.targetId);
      return {
        ...base,
        kind: 'C1',
        difficulty: 1,
        prompt: speech(content, 'C1', plan.recipeId, {
          $label: target.labelClipId,
        }),
        options: options(target),
        correctOptionId: colorOption(target).id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'C2': {
      const target = pick(content.colors, random);
      const object = pick(
        content.countObjects.filter((x) => x.kind === 'tinted'),
        random,
      );
      return {
        ...base,
        kind: 'C2',
        difficulty: 1,
        prompt: {
          ...speech(content, 'C2', content.recipes.C2[0]!.id),
          kind: 'tinted-object',
          object: {
            kind: 'tinted',
            id: object.id,
            image: object.image,
            hex: target.hex,
          },
        },
        options: options(target),
        correctOptionId: colorOption(target).id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'C4': {
      const colors = shuffle(content.colors, random);
      const letters = new Map(
        [...new Set(plan.pattern)].map((letter, i) => [letter, colors[i]!.id]),
      );
      const target = colors[0]!;
      return {
        ...base,
        kind: 'C4',
        difficulty: 3,
        prompt: {
          ...speech(content, 'C4', content.recipes.C4[0]!.id),
          kind: 'color-sequence',
          pattern: plan.pattern,
          colorIds: [...plan.pattern].map((letter) => letters.get(letter)!),
        },
        options: options(target),
        correctOptionId: colorOption(target).id,
        confirmation: confirmation(target.labelClipId),
      };
    }
    case 'C3-A':
    case 'C3-B': {
      const color = pick(content.colors, random),
        shape = pick(content.shapes, random);
      const otherColor = pick(
        content.colors.filter((x) => x.id !== color.id),
        random,
      );
      const otherShape = pick(
        content.shapes.filter((x) => x.id !== shape.id),
        random,
      );
      const makeShape = (s: typeof shape, c: typeof color): ShapeOption => ({
        kind: 'shape',
        id: `${s.id}:${c.id}`,
        shapeId: s.id,
        colorId: c.id,
        labelTt: `${c.labelTt} ${byId(content.countObjects, s.countObjectId).labelTt.toLowerCase()}`,
      });
      const target = makeShape(shape, color);
      const partials = [
        makeShape(shape, otherColor),
        makeShape(otherShape, color),
      ];
      const bindings = {
        $color: color.labelClipId,
        $shapeTarget: shape.targetClipId,
      };
      const recipe = pick(content.recipes[plan.kind], random);
      const labelClips = [
        color.labelClipId,
        byId(content.countObjects, shape.countObjectId).labelClipId,
      ];
      const pool = content.shapes.flatMap((s) =>
        content.colors.map((c) => makeShape(s, c)),
      );
      if (plan.kind === 'C3-A') {
        const required = [target, ...partials];
        const rest = shuffle(
          pool.filter(
            (x) =>
              !required.some((r) => r.id === x.id) &&
              (x.shapeId === shape.id || x.colorId === color.id),
          ),
          random,
        );
        return {
          ...base,
          kind: 'C3-A',
          difficulty: 2,
          prompt: {
            ...speech(content, plan.kind, recipe.id, bindings),
            kind: 'shape-request',
            shapeId: shape.id,
            colorId: color.id,
          },
          options: shuffle(
            [...required, ...rest.slice(0, plan.optionCount - required.length)],
            random,
          ),
          correctOptionId: target.id,
          confirmation: { type: 'sequence', clipIds: labelClips },
        };
      }
      const size = pick(content.sizes, random);
      const otherSize = pick(
        content.sizes.filter((x) => x.id !== size.id),
        random,
      );
      const sized = (
        option: ShapeOption,
        s: typeof size,
      ): SizedShapeOption => ({
        ...option,
        kind: 'sized-shape',
        id: `${option.id}:${s.id}`,
        sizeId: s.id,
        labelTt: `${s.labelTt} ${option.labelTt.toLowerCase()}`,
      });
      // Размер цели нельзя вывести из частоты: оба размера поровну, нечётный остаток случаен.
      const mixedPartials = shuffle(partials, random);
      const required = [
        sized(target, size),
        sized(mixedPartials[0]!, size),
        sized(mixedPartials[1]!, otherSize),
        sized(target, otherSize),
      ];
      const rest = shuffle(
        pool
          .flatMap((x) => content.sizes.map((s) => sized(x, s)))
          .filter(
            (x) =>
              !required.some((r) => r.id === x.id) &&
              (x.shapeId === shape.id || x.colorId === color.id),
          ),
        random,
      );
      const extra = shuffle(content.sizes, random)
        .slice(0, plan.optionCount - required.length)
        .map((s) =>
          pick(
            rest.filter((x) => x.sizeId === s.id),
            random,
          ),
        );
      return {
        ...base,
        kind: 'C3-B',
        difficulty: 2,
        prompt: {
          ...speech(content, plan.kind, recipe.id, {
            ...bindings,
            $size: size.labelClipId,
          }),
          kind: 'sized-shape-request',
          shapeId: shape.id,
          colorId: color.id,
          sizeId: size.id,
        },
        options: shuffle([...required, ...extra], random),
        correctOptionId: required[0]!.id,
        confirmation: {
          type: 'sequence',
          clipIds: [size.labelClipId, ...labelClips],
        },
      };
    }
  }
}
