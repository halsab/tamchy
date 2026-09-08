import assert from 'node:assert/strict';
import { z } from 'zod';

export const browsers = ['chromium', 'webkit', 'firefox'] as const;
export type Browser = (typeof browsers)[number];
const testSchema = z.object({
  projectName: z.enum(browsers),
  expectedStatus: z.string(),
  status: z.string(),
  results: z.array(z.object({ status: z.string() })),
});
const suiteSchema = z.object({
  specs: z
    .array(z.object({ id: z.string(), tests: z.array(testSchema) }))
    .default([]),
  get suites(): z.ZodDefault<z.ZodArray<typeof suiteSchema>> {
    return z.array(suiteSchema).default([]);
  },
});
export const resultSchema = z.strictObject({
  id: z.string(),
  browser: z.enum(browsers),
  expectedStatus: z.string(),
  status: z.string(),
  results: z.array(z.string()),
});
export const evidenceSchema = z.strictObject({
  browser: z.enum(browsers),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  tests: z.array(resultSchema),
});
export type BrowserEvidence = z.infer<typeof evidenceSchema>;

export function collectTests(input: unknown) {
  const report = z
    .object({ errors: z.array(z.unknown()), suites: z.array(suiteSchema) })
    .parse(input);
  assert.equal(report.errors.length, 0, 'Глобальные ошибки Playwright');
  const tests: z.infer<typeof resultSchema>[] = [];
  function visit(suite: z.infer<typeof suiteSchema>) {
    for (const spec of suite.specs)
      for (const test of spec.tests)
        tests.push({
          id: spec.id,
          browser: test.projectName,
          expectedStatus: test.expectedStatus,
          status: test.status,
          results: test.results.map((result) => result.status),
        });
    suite.suites.forEach(visit);
  }
  report.suites.forEach(visit);
  return tests;
}

export function verifyBrowser(
  browser: Browser,
  expected: string[],
  tests: z.infer<typeof resultSchema>[],
) {
  assert(
    expected.length > 0 && new Set(expected).size === expected.length,
    'Пустой или повторяющийся план',
  );
  assert.deepEqual(
    tests.map((test) => test.id).sort(),
    [...expected].sort(),
    `Неполный набор ${browser}`,
  );
  assert(
    tests.some((test) => test.status === 'expected'),
    'Нет выполненных тестов',
  );
  for (const test of tests) {
    assert.equal(test.browser, browser, 'Другой браузер');
    const skipped =
      test.expectedStatus === 'skipped' && test.status === 'skipped';
    assert(
      skipped ||
        (test.expectedStatus === 'passed' && test.status === 'expected'),
      `Неуспешный тест ${test.id}`,
    );
    assert.deepEqual(
      test.results,
      [skipped ? 'skipped' : 'passed'],
      `Тест ${test.id} не выполнен однократно`,
    );
  }
}

export function verifyMatrix(
  expected: Record<string, string[]>,
  planSha256: string,
  input: unknown[],
) {
  const evidence = input.map((entry) => evidenceSchema.parse(entry));
  assert.deepEqual(
    evidence.map((entry) => entry.browser).sort(),
    [...browsers].sort(),
    'Нужны все три браузера',
  );
  for (const entry of evidence) {
    assert.equal(
      entry.planSha256,
      planSha256,
      'Проверен другой план или артефакт',
    );
    verifyBrowser(entry.browser, expected[entry.browser]!, entry.tests);
  }
}
