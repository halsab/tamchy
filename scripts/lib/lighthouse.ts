import assert from 'node:assert/strict';

export type Metrics = { lcp: number; cls: number };
export function summarizeMetrics(runs: Metrics[]) {
  assert.equal(runs.length, 3, 'Нужны ровно три прогона');
  for (const run of runs)
    for (const value of [run.lcp, run.cls])
      assert(
        Number.isFinite(value) && value >= 0,
        'Показатель отсутствует или некорректен',
      );
  const median = (values: number[]) => values.toSorted((a, b) => a - b)[1]!;
  const lcp = median(runs.map((run) => run.lcp));
  const cls = median(runs.map((run) => run.cls));
  return { lcp, cls, passed: lcp <= 2500 && cls <= 0.1 };
}
