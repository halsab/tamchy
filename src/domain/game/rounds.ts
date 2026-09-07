import type { GameCategory, Round } from './models.ts';

export function createRoundGenerator(
  category: GameCategory,
  random: () => number,
): () => Round {
  const ids = category.items.map(({ id }) => id);
  let remaining: string[] = [];
  let previous: string | undefined;
  let roundId = 0;

  function indexBelow(length: number) {
    const value = random();
    if (!(value >= 0 && value < 1))
      throw new RangeError('Случайное значение должно быть в [0, 1).');
    return Math.floor(value * length);
  }

  return () => {
    if (remaining.length === 0) {
      remaining = [...ids];
      for (let index = remaining.length - 1; index > 0; index--) {
        const other = indexBelow(index + 1);
        [remaining[index], remaining[other]] = [
          remaining[other]!,
          remaining[index]!,
        ];
      }
      // Обмен вместо повторного перемешивания ограничивает работу даже при постоянном RNG.
      if (remaining[0] === previous) {
        [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
      }
    }
    const targetId = remaining.shift()!;
    const distractors = ids.filter((id) => id !== targetId);
    const distractor = distractors[indexBelow(distractors.length)]!;
    const optionIds: [string, string] =
      indexBelow(2) === 0 ? [targetId, distractor] : [distractor, targetId];
    previous = targetId;
    return { roundId: ++roundId, categoryId: category.id, targetId, optionIds };
  };
}
