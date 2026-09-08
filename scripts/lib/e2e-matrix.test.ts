import { expect, it } from 'vitest';
import {
  browsers,
  collectTests,
  verifyMatrix,
  verifyBrowser,
} from './e2e-matrix.ts';

const expected = Object.fromEntries(
  browsers.map((browser) => [browser, [`${browser}-1`, `${browser}-2`]]),
);
function report(browser: string) {
  return {
    errors: [],
    suites: [
      {
        specs: [1, 2].map((id) => ({
          id: `${browser}-${id}`,
          tests: [
            {
              projectName: browser,
              expectedStatus: 'passed',
              status: 'expected',
              results: [{ status: 'passed' }],
            },
          ],
        })),
      },
    ],
  };
}
function evidence() {
  return browsers.map((browser) => ({
    browser,
    planSha256: 'a'.repeat(64),
    tests: collectTests(report(browser)),
  }));
}
it('принимает только полный успешный набор трёх браузеров для одного плана', () => {
  expect(() =>
    verifyMatrix(expected, 'a'.repeat(64), evidence()),
  ).not.toThrow();
});
it.each([
  'missing browser',
  'duplicate browser',
  'foreign artifact',
  'missing test',
  'duplicate test',
  'failed',
  'retry',
  'unexecuted',
] as const)('отклоняет %s', (change) => {
  const all = evidence();
  const first = all[0]!;
  if (change === 'missing browser') all.pop();
  if (change === 'duplicate browser') all[2] = first;
  if (change === 'foreign artifact') first.planSha256 = 'b'.repeat(64);
  if (change === 'missing test') first.tests.pop();
  if (change === 'duplicate test') first.tests[1] = first.tests[0]!;
  if (change === 'failed') first.tests[0]!.results = ['failed'];
  if (change === 'retry') first.tests[0]!.results = ['failed', 'passed'];
  if (change === 'unexecuted') first.tests[0]!.results = [];
  expect(() => verifyMatrix(expected, 'a'.repeat(64), all)).toThrow();
});
it('учитывает предусмотренный пропуск, но не выдаёт непройденный тест за пропуск', () => {
  const tests = collectTests(report('webkit'));
  Object.assign(tests[1]!, {
    expectedStatus: 'skipped',
    status: 'skipped',
    results: ['skipped'],
  });
  expect(() => verifyBrowser('webkit', expected.webkit!, tests)).not.toThrow();
  tests[1]!.expectedStatus = 'passed';
  expect(() => verifyBrowser('webkit', expected.webkit!, tests)).toThrow();
});
it('отклоняет глобальную ошибку Playwright и чужой браузер', () => {
  expect(() =>
    collectTests({
      ...report('chromium'),
      errors: [{ message: 'setup failed' }],
    }),
  ).toThrow();
  expect(() =>
    verifyBrowser(
      'chromium',
      expected.chromium!,
      collectTests(report('firefox')),
    ),
  ).toThrow();
});
