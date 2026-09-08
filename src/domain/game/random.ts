export function randomIndex(length: number, random: () => number): number {
  if (!Number.isSafeInteger(length) || length < 1)
    throw new RangeError('Пустой или неверный пул.');
  const value = random();
  if (!(value >= 0 && value < 1))
    throw new RangeError('Случайное значение должно быть в [0, 1).');
  return Math.floor(value * length);
}
export function shuffle<T>(input: readonly T[], random: () => number): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const other = randomIndex(i + 1, random);
    [result[i], result[other]] = [result[other]!, result[i]!];
  }
  return result;
}
export function createShuffledCycle<T>(
  pool: readonly T[],
  random: () => number,
): () => T {
  if (!pool.length || new Set(pool).size !== pool.length)
    throw new Error('Цикл требует непустой пул без повторов.');
  const values = [...pool];
  let remaining: T[] = [];
  let previous: T | undefined;
  return () => {
    if (!remaining.length) {
      remaining = shuffle(values, random);
      // Обмен на стыке сохраняет инвариант даже при постоянной случайности.
      if (remaining.length > 1 && remaining[0] === previous)
        [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
    }
    const value = remaining.shift()!;
    previous = value;
    return value;
  };
}
