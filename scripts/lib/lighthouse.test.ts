import { expect, it } from 'vitest';
import { summarizeMetrics } from './lighthouse.ts';

it('проверяет независимые медианы ровно трёх измерений', () => {
  expect(
    summarizeMetrics([
      { lcp: 2500, cls: 0.1 },
      { lcp: 1000, cls: 0 },
      { lcp: 9000, cls: 0.9 },
    ]),
  ).toEqual({ lcp: 2500, cls: 0.1, passed: true });
});
it.each([
  [
    { lcp: 2501, cls: 0 },
    { lcp: 1000, cls: 0 },
    { lcp: 9000, cls: 0 },
  ],
  [
    { lcp: 1000, cls: 0.101 },
    { lcp: 1000, cls: 0.2 },
    { lcp: 1000, cls: 0 },
  ],
])('не скрывает превышение порога медианой другого показателя', (...runs) => {
  expect(summarizeMetrics(runs).passed).toBe(false);
});
it('не принимает отсутствующие, нечисловые и дополнительные результаты', () => {
  for (const runs of [
    [],
    [{ lcp: 1, cls: 0 }],
    Array(4).fill({ lcp: 1, cls: 0 }),
    [
      { lcp: NaN, cls: 0 },
      { lcp: 1, cls: 0 },
      { lcp: 1, cls: 0 },
    ],
  ]) {
    expect(() => summarizeMetrics(runs)).toThrow();
  }
});
