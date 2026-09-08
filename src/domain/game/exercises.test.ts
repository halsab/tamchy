import { describe, expect, it } from 'vitest';
import { contentV2 } from '../../content/v2/catalog.ts';
import type { CategoryId } from '../../content/types.ts';
import { createExerciseGenerator } from './exercises.ts';
import { audioClipIds } from './exercise.ts';
import { createSessionExercises } from '../../features/game/session-rounds.ts';

const cycleRandom = () => {
  let cursor = 0;
  const values = [0, 0.99, 0.25, 0.72, 0.41];
  return () => values[cursor++ % values.length]!;
};
const expectedIds = {
  colors: contentV2.colors.map((x) => `color-${x.id}`),
  animals: contentV2.animals.map((x) => x.id),
  numbers: contentV2.numbers.filter((x) => x.value <= 10).map((x) => x.id),
};

describe('упражнения младшего v2', () => {
  it.each(['colors', 'animals', 'numbers'] as const)(
    '%s: полные циклы, 2/3/4 ответа, единственность и независимые позиции',
    (category) => {
      const generate = createExerciseGenerator(
        contentV2,
        category,
        cycleRandom(),
      );
      const expected = expectedIds[category];
      const rounds = Array.from({ length: expected.length * 6 }, (_, i) =>
        generate(([2, 3, 4] as const)[i % 3]!),
      );
      for (let cycle = 0; cycle < 6; cycle++)
        expect(
          rounds
            .slice(cycle * expected.length, (cycle + 1) * expected.length)
            .map((x) => x.correctOptionId)
            .sort(),
        ).toEqual([...expected].sort());
      const positions = new Set<number>();
      for (const [index, round] of rounds.entries()) {
        expect(round.id).toBe(index + 1);
        expect(round.categoryId).toBe(category);
        expect(round.difficulty).toBe(1);
        expect(round.options.length).toBe(([2, 3, 4] as const)[index % 3]);
        expect(new Set(round.options.map((x) => x.id)).size).toBe(
          round.options.length,
        );
        expect(
          round.options.filter((x) => x.id === round.correctOptionId),
        ).toHaveLength(1);
        expect(round.options.every((x) => expected.includes(x.id))).toBe(true);
        positions.add(
          round.options.findIndex((x) => x.id === round.correctOptionId),
        );
        if (index > 0)
          expect(round.correctOptionId).not.toBe(
            rounds[index - 1]!.correctOptionId,
          );
        expect(round.prompt.kind).toBe('spoken');
        expect(round.prompt.audio.type).toBe('sequence');
        expect(round.confirmation.type).toBe('clip');
        if (round.kind === 'C1')
          for (const option of round.options)
            expect(option.hex).toBe(
              contentV2.colors.find((x) => `color-${x.id}` === option.id)!.hex,
            );
        if (round.kind === 'A1')
          for (const option of round.options)
            expect(option.image).toBe(
              contentV2.animals.find((x) => x.id === option.id)!.image,
            );
        if (round.kind === 'N1-A') {
          expect(
            round.options.every((x) => x.value >= 1 && x.value <= 10),
          ).toBe(true);
          expect(round.countObject.id).toBeTruthy();
          expect(
            contentV2.countObjects.some((x) => x.id === round.countObject.id),
          ).toBe(true);
        }
      }
      expect(positions).toEqual(new Set([0, 1, 2, 3]));
    },
  );
  it.each(['colors', 'animals', 'numbers'] as const)(
    '%s: каждая цель использует все утверждённые формулировки',
    (category) => {
      const count = category === 'colors' ? 3 : 5;
      const generate = createExerciseGenerator(contentV2, category, () => 0);
      const forms = new Map<string, Set<string>>();
      for (
        let index = 0;
        index < expectedIds[category].length * count;
        index++
      ) {
        const round = generate(2);
        const seen = forms.get(round.correctOptionId) ?? new Set<string>();
        seen.add(round.prompt.textTt);
        forms.set(round.correctOptionId, seen);
      }
      expect([...forms.values()].every((x) => x.size === count)).toBe(true);
    },
  );
  it('числовой пул достигает всех 13 типов без изменения размера по количеству', () => {
    const generate = createExerciseGenerator(
      contentV2,
      'numbers',
      cycleRandom(),
    );
    const objects = new Set<string>();
    for (let i = 0; i < 130; i++) {
      const round = generate(4);
      if (round.kind === 'N1-A') objects.add(round.countObject.id);
    }
    expect(objects.size).toBe(13);
  });
  it('результат детерминирован; каталог и прежние упражнения не изменяются', () => {
    const input = structuredClone(contentV2);
    const copy = structuredClone(input);
    const a = createExerciseGenerator(input, 'numbers', cycleRandom());
    const b = createExerciseGenerator(input, 'numbers', cycleRandom());
    const first = a(4);
    const saved = structuredClone(first);
    expect(first).toEqual(b(4));
    Object.freeze(first.options);
    Object.freeze(first);
    for (let i = 0; i < 40; i++) expect(a(3)).toEqual(b(3));
    expect(first).toEqual(saved);
    expect(input).toEqual(copy);
  });
  it.each([0, 0.999999])('ограничен при постоянном RNG %s', (value) => {
    for (const category of ['colors', 'animals', 'numbers'] as const) {
      let calls = 0;
      const generate = createExerciseGenerator(contentV2, category, () => {
        calls++;
        return value;
      });
      const rounds = Array.from(
        { length: expectedIds[category].length * 3 },
        () => generate(4),
      );
      expect(calls).toBeLessThan(rounds.length * 60);
      rounds.forEach((round, i) => {
        if (i)
          expect(round.correctOptionId).not.toBe(
            rounds[i - 1]!.correctOptionId,
          );
      });
    }
  });
  it.each([-1, 1, NaN, Infinity])('проверяет RNG %s', (value) =>
    expect(() =>
      createExerciseGenerator(contentV2, 'colors', () => value)(2),
    ).toThrow(RangeError),
  );
  it('отклоняет недопустимые количества и раздел', () => {
    const generate = createExerciseGenerator(contentV2, 'colors', () => 0);
    for (const count of [0, 1, 5, NaN])
      expect(() => generate(count as 2)).toThrow(RangeError);
    expect(() =>
      createExerciseGenerator(contentV2, 'unknown' as CategoryId, () => 0),
    ).toThrow();
  });
  it('подсказка сохраняет целые словоформы, регистр и вопросительный знак', () => {
    const generate = createExerciseGenerator(
      contentV2,
      'animals',
      () => 0.999999,
    );
    const cat = [];
    for (let i = 0; i < 39 * 5; i++) {
      const round = generate(2);
      if (round.correctOptionId === 'animal-cat') cat.push(round);
    }
    expect(cat.map((x) => x.prompt.textTt)).toEqual([
      'Мәче кайда?',
      'Мәчене тап.',
      'Мәчене сайла.',
      'Мәчене күрсәт.',
      'Кайсысы мәче?',
    ]);
    expect(audioClipIds(cat[1]!.prompt.audio)).toEqual([
      'animal.cat.target',
      'common.find',
    ]);
    expect(audioClipIds(cat[1]!.confirmation)).toEqual(['animal.cat']);
    const numbers = createExerciseGenerator(
      contentV2,
      'numbers',
      () => 0.999999,
    )(4);
    expect(numbers.kind).toBe('N1-A');
    if (numbers.kind === 'N1-A') {
      expect(numbers.options.map((x) => x.value).sort((a, b) => a - b)).toEqual(
        [1, 2, 3, 4],
      );
    }
  });
  it('отклоняет неизвестный обязательный клип', () => {
    const content = structuredClone(contentV2);
    const incomplete = {
      ...content,
      audio: content.audio.filter((x) => x.id !== 'color.red'),
    };
    expect(() =>
      createExerciseGenerator(incomplete, 'colors', () => 0.999999)(2),
    ).toThrow('Неизвестный клип');
  });
  it('повторная доставка сохраняет упражнение, цель и формулировку', () => {
    const sequence = createSessionExercises(
      'one',
      contentV2,
      'animals',
      () => 0,
    );
    const one = sequence.get(1, 2);
    expect(sequence.get(1, 2)).toBe(one);
    expect(() => sequence.get(1, 3)).toThrow();
    expect(() => sequence.get(2, 2)).toThrow();
    sequence.accept(99);
    expect(sequence.get(1, 2)).toBe(one);
    sequence.accept(1);
    const two = sequence.get(2, 4);
    expect(two.id).toBe(2);
    expect(two.options).toHaveLength(4);
    expect(sequence.get(2, 4)).toBe(two);
    expect(() => sequence.get(3, 4)).toThrow();
  });
});
