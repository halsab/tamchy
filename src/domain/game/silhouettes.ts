export const silhouettePairKey = (a: string, b: string) =>
  [a, b].sort().join('|');

export function findCompatibleAnimals(
  target: string,
  count: number,
  pool: readonly string[],
  forbidden: ReadonlySet<string>,
): readonly string[] | null {
  if (!pool.includes(target) || count < 1 || !Number.isInteger(count))
    return null;
  const candidates = [...new Set(pool)].filter((id) => id !== target);
  // Конечный поиск проверяет все пары, включая пары помех; порядок задаёт вызывающая сторона.
  function visit(
    selected: readonly string[],
    from: number,
  ): readonly string[] | null {
    if (selected.length === count) return selected;
    if (selected.length + candidates.length - from < count) return null;
    for (let index = from; index < candidates.length; index++) {
      const next = candidates[index]!;
      if (selected.some((id) => forbidden.has(silhouettePairKey(id, next))))
        continue;
      const result = visit([...selected, next], index + 1);
      if (result) return result;
    }
    return null;
  }
  return visit([target], 0);
}
