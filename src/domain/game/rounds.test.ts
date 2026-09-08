import { describe, expect, it } from 'vitest';
import {
  gameCategories as categories,
  categoryIds,
} from '../../../tests/helpers/game-content.ts';
import { createRoundGenerator } from './rounds.ts';

function randomSequence(values: readonly number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe('генератор раундов', () => {
  it.each(categories)('$id: циклы целей, варианты и границы', (category) => {
    const snapshot = structuredClone(category);
    const generate = createRoundGenerator(
      category,
      randomSequence([0, 0.99, 0.3, 0.7]),
    );
    const ids = categoryIds(category);
    const rounds = Array.from({ length: ids.length * 4 }, () => generate());
    for (let cycle = 0; cycle < 4; cycle++) {
      expect(
        rounds
          .slice(cycle * ids.length, (cycle + 1) * ids.length)
          .map(({ correctOptionId }) => correctOptionId)
          .sort(),
      ).toEqual([...ids].sort());
    }
    rounds.forEach((round, index) => {
      expect(round.id).toBe(index + 1);
      expect(round.categoryId).toBe(category.id);
      expect(round.options.map((x) => x.id)).toHaveLength(2);
      expect(new Set(round.options.map((x) => x.id)).size).toBe(2);
      expect(
        round.options
          .map((x) => x.id)
          .filter((id) => id === round.correctOptionId),
      ).toHaveLength(1);
      expect(
        round.options.map((x) => x.id).every((id) => ids.includes(id)),
      ).toBe(true);
      if (index > 0)
        expect(round.correctOptionId).not.toBe(
          rounds[index - 1]!.correctOptionId,
        );
    });
    expect(category).toEqual(snapshot);
  });

  it.each([0, 0.999999])(
    'ограничен и не зацикливается с постоянной случайностью %s',
    (value) => {
      for (const category of categories) {
        let calls = 0;
        const generate = createRoundGenerator(category, () => {
          calls++;
          return value;
        });
        const rounds = Array.from(
          { length: categoryIds(category).length * 3 },
          () => generate(),
        );
        expect(calls).toBeLessThanOrEqual(rounds.length * 60);
        for (let index = 1; index < rounds.length; index++) {
          expect(rounds[index]!.correctOptionId).not.toBe(
            rounds[index - 1]!.correctOptionId,
          );
        }
      }
    },
  );

  it('исправляет совпадение на границе без новых случайных попыток', () => {
    const category = categories[0]!;
    const size = categoryIds(category).length;
    let calls = 0;
    let boundary = false;
    const generate = createRoundGenerator(category, () => {
      calls++;
      if (boundary) {
        boundary = false;
        return 0;
      }
      return 0.999999;
    });
    const rounds = Array.from({ length: size }, () => generate());
    expect(rounds.at(-1)!.correctOptionId).toBe(categoryIds(category).at(-1));
    const before = calls;
    boundary = true;
    const next = generate();
    expect(next.correctOptionId).toBe(categoryIds(category)[1]);
    expect(calls - before).toBe(size - 1 + (size - 2) + 1);
  });

  it('воспроизводим; выбор позиции не зависит от цикла и помехи', () => {
    const category = categories[0]!;
    const size = categoryIds(category).length;
    const values = Array<number>(size - 1 + 4 * (size + 1)).fill(0.999999);
    for (const index of [2, 3])
      values[size - 1 + index * (size + 1) + size - 2] = 0;
    const generate = createRoundGenerator(category, randomSequence(values));
    const replay = createRoundGenerator(category, randomSequence(values));
    const rounds = Array.from({ length: 4 }, () => generate());
    expect(rounds).toEqual(Array.from({ length: 4 }, () => replay()));
    expect(
      rounds.map((round) =>
        round.options.map((x) => x.id).indexOf(round.correctOptionId),
      ),
    ).toEqual([0, 0, 1, 1]);
  });

  it('не изменяет замороженный каталог и ранее выданный раунд', () => {
    const category = structuredClone(categories[0]!);
    category.content.colors.forEach(Object.freeze);
    Object.freeze(category.content.colors);
    Object.freeze(category);
    const generate = createRoundGenerator(category, () => 0);
    const first = generate();
    const snapshot = structuredClone(first);
    Object.freeze(first.options);
    Object.freeze(first);
    Array.from({ length: 20 }, () => generate());
    expect(first).toEqual(snapshot);
  });

  it.each([-0.1, 1, NaN, Infinity])(
    'отклоняет нарушенный контракт случайности %s',
    (value) => {
      expect(() => createRoundGenerator(categories[0]!, () => value)()).toThrow(
        RangeError,
      );
    },
  );
});
