import { describe, expect, it } from 'vitest';
import data from '../../content/catalog.json';
import type { Catalog } from '../../content/types.ts';
import { createRoundGenerator } from './rounds.ts';

const catalog = data as Catalog;

function randomSequence(values: readonly number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe('генератор раундов', () => {
  it.each(catalog.categories)(
    '$id: циклы целей, варианты и границы',
    (category) => {
      const snapshot = structuredClone(category);
      const generate = createRoundGenerator(
        category,
        randomSequence([0, 0.99, 0.3, 0.7]),
      );
      const ids = category.items.map(({ id }) => id);
      const rounds = Array.from({ length: ids.length * 4 }, generate);
      for (let cycle = 0; cycle < 4; cycle++) {
        expect(
          rounds
            .slice(cycle * ids.length, (cycle + 1) * ids.length)
            .map(({ targetId }) => targetId)
            .sort(),
        ).toEqual([...ids].sort());
      }
      rounds.forEach((round, index) => {
        expect(round.roundId).toBe(index + 1);
        expect(round.categoryId).toBe(category.id);
        expect(round.optionIds).toHaveLength(2);
        expect(new Set(round.optionIds).size).toBe(2);
        expect(
          round.optionIds.filter((id) => id === round.targetId),
        ).toHaveLength(1);
        expect(round.optionIds.every((id) => ids.includes(id))).toBe(true);
        if (index > 0)
          expect(round.targetId).not.toBe(rounds[index - 1]!.targetId);
      });
      expect(category).toEqual(snapshot);
    },
  );

  it.each([0, 0.999999])(
    'ограничен и не зацикливается с постоянной случайностью %s',
    (value) => {
      for (const category of catalog.categories) {
        let calls = 0;
        const generate = createRoundGenerator(category, () => {
          calls++;
          return value;
        });
        const rounds = Array.from(
          { length: category.items.length * 3 },
          generate,
        );
        expect(calls).toBeLessThanOrEqual(
          rounds.length * 2 + category.items.length * 3,
        );
        for (let index = 1; index < rounds.length; index++) {
          expect(rounds[index]!.targetId).not.toBe(rounds[index - 1]!.targetId);
        }
      }
    },
  );

  it('исправляет совпадение на границе без новых случайных попыток', () => {
    // Первый цикл: red, yellow, green, blue; следующий начинается с blue.
    const random = randomSequence([
      0.99,
      0.99,
      0.99,
      ...Array<number>(8).fill(0.2),
      0,
      0.99,
      0.99,
      0.2,
      0.2,
    ]);
    const generate = createRoundGenerator(catalog.categories[0]!, random);
    const rounds = Array.from({ length: 5 }, generate);
    expect(rounds[3]!.targetId).toBe('color-blue');
    expect(rounds[4]!.targetId).not.toBe('color-blue');
  });

  it('воспроизводим; выбор позиции не зависит от цикла и помехи', () => {
    const category = catalog.categories[0]!;
    const values = [0.99, 0.99, 0.99, 0, 0.1, 0, 0.1, 0, 0.9, 0, 0.9];
    const generate = createRoundGenerator(category, randomSequence(values));
    const replay = createRoundGenerator(category, randomSequence(values));
    const rounds = Array.from({ length: 4 }, generate);
    expect(rounds).toEqual(Array.from({ length: 4 }, replay));
    expect(
      rounds.map((round) => round.optionIds.indexOf(round.targetId)),
    ).toEqual([0, 0, 1, 1]);
  });

  it('не изменяет замороженный каталог и ранее выданный раунд', () => {
    const category = structuredClone(catalog.categories[0]!);
    category.items.forEach(Object.freeze);
    Object.freeze(category.items);
    Object.freeze(category);
    const generate = createRoundGenerator(category, () => 0);
    const first = generate();
    const snapshot = structuredClone(first);
    Object.freeze(first.optionIds);
    Object.freeze(first);
    Array.from({ length: 20 }, generate);
    expect(first).toEqual(snapshot);
  });

  it.each([-0.1, 1, NaN, Infinity])(
    'отклоняет нарушенный контракт случайности %s',
    (value) => {
      expect(() =>
        createRoundGenerator(catalog.categories[0]!, () => value)(),
      ).toThrow(RangeError);
    },
  );
});
