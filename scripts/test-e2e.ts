import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  createLegacyFixture,
  createJuniorFixture,
  createUpdateFixture,
} from './lib/e2e-update.ts';
import {
  browsers,
  collectTests,
  verifyBrowser,
  verifyMatrix,
  type Browser,
} from './lib/e2e-matrix.ts';
import {
  captureRelease,
  preserveRelease,
  readRelease,
  releaseDirectory,
  releaseSchema,
  sha256,
  snapshotFiles,
  verifyRelease,
} from './lib/release.ts';

const base = '/tamchy/';
const directory = releaseDirectory(base);
const reportPath = join(directory, 'release.json');
const planPath = resolve('.release/e2e-plan.json');
const resultsDirectory = resolve('.release/results');
const fixturesDirectory = resolve('.release/fixtures');
const env = { ...process.env, VITE_BASE: base };
const planSchema = z.strictObject({
  reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected: z.record(z.enum(browsers), z.array(z.string()).min(1)),
  fixtures: z.strictObject({
    update: releaseSchema.shape.files,
    mvp: releaseSchema.shape.files,
    junior: releaseSchema.shape.files,
  }),
});

function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = env,
) {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}: ${result.status}`,
  );
}
async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
function listTests() {
  const output = execFileSync(
    process.execPath,
    ['node_modules/playwright/cli.js', 'test', '--list', '--reporter=json'],
    {
      env: {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: '',
        PLAYWRIGHT_JSON_OUTPUT_NAME: '',
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return collectTests(JSON.parse(output));
}

async function prepare() {
  await rm('.release', { recursive: true, force: true });
  run('npm', ['run', 'build']);
  run('npm', ['run', 'check:assets']);
  run('npm', ['run', 'check:budgets']);
  const report = await captureRelease(base);
  await preserveRelease('dist', directory, report);
  await mkdir(fixturesDirectory, { recursive: true });
  for (const [name, create] of [
    ['update', createUpdateFixture],
    ['mvp', createLegacyFixture],
    ['junior', createJuniorFixture],
  ] as const) {
    const root = await create(base);
    try {
      await cp(join(root, 'dist'), join(fixturesDirectory, name), {
        recursive: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const listed = listTests();
  await json(
    planPath,
    planSchema.parse({
      reportSha256: sha256(await readFile(reportPath)),
      expected: Object.fromEntries(
        browsers.map((browser) => [
          browser,
          listed
            .filter((test) => test.browser === browser)
            .map((test) => test.id),
        ]),
      ),
      fixtures: {
        update: await snapshotFiles(join(fixturesDirectory, 'update')),
        mvp: await snapshotFiles(join(fixturesDirectory, 'mvp')),
        junior: await snapshotFiles(join(fixturesDirectory, 'junior')),
      },
    }),
  );
}

async function verifyInputs() {
  const bytes = await readFile(planPath);
  const plan = planSchema.parse(JSON.parse(bytes.toString()));
  assert.equal(
    sha256(await readFile(reportPath)),
    plan.reportSha256,
    'Изменён отчёт кандидата',
  );
  const report = await readRelease(reportPath);
  assert.equal(report.e2e, 'pending', 'Нужен новый подготовленный кандидат');
  await verifyRelease(
    join(directory, 'dist'),
    report,
    base,
    process.env.CI ? process.env.GITHUB_SHA : undefined,
    false,
  );
  for (const name of ['update', 'mvp', 'junior'] as const)
    assert.deepEqual(
      await snapshotFiles(join(fixturesDirectory, name)),
      plan.fixtures[name],
      `Изменена сборка ${name}`,
    );
  return { plan, planSha256: sha256(bytes), report };
}

async function execute(args: string[], selected?: Browser) {
  const input = await verifyInputs();
  await rm('dist', { recursive: true, force: true });
  await cp(join(directory, 'dist'), 'dist', { recursive: true });
  const reports = resolve(
    process.env.TAMCHY_E2E_REPORTS ?? 'reports/e2e',
    selected ?? 'local',
  );
  const output = join(reports, 'subpath/results.json');
  await rm(output, { force: true });
  run(process.execPath, ['node_modules/playwright/cli.js', 'test', ...args], {
    ...env,
    TAMCHY_E2E_REPORTS: reports,
    PLAYWRIGHT_JSON_OUTPUT_FILE: output,
    TAMCHY_UPDATE_DIST: join(fixturesDirectory, 'update'),
    TAMCHY_MVP_DIST: join(fixturesDirectory, 'mvp'),
    TAMCHY_JUNIOR_DIST: join(fixturesDirectory, 'junior'),
  });
  await verifyInputs();
  await verifyRelease('dist', input.report, base, undefined, false);
  const tests = collectTests(JSON.parse(await readFile(output, 'utf8')));
  if (selected || args.length === 0) {
    await mkdir(resultsDirectory, { recursive: true });
    for (const browser of selected ? [selected] : browsers) {
      const own = tests.filter((test) => test.browser === browser);
      verifyBrowser(browser, input.plan.expected[browser], own);
      await json(join(resultsDirectory, `${browser}.json`), {
        browser,
        planSha256: input.planSha256,
        tests: own,
      });
    }
  } else {
    await json(reportPath, { ...input.report, e2e: 'filtered' });
  }
}

async function finalize() {
  const input = await verifyInputs();
  assert.deepEqual(
    (await readdir(resultsDirectory)).sort(),
    browsers.map((browser) => `${browser}.json`).sort(),
    'Нужны ровно три отчёта браузеров',
  );
  const evidence = await Promise.all(
    browsers.map(
      async (browser) =>
        JSON.parse(
          await readFile(join(resultsDirectory, `${browser}.json`), 'utf8'),
        ) as unknown,
    ),
  );
  verifyMatrix(input.plan.expected, input.planSha256, evidence);
  await json(reportPath, { ...input.report, e2e: 'full' });
  await verifyRelease(
    join(directory, 'dist'),
    await readRelease(reportPath),
    base,
  );
  console.log(
    'Полная матрица подтверждена; все браузеры проверили один неизменённый кандидат.',
  );
}

const args = process.argv.slice(2);
if (args[0] === 'prepare' && args.length === 1) await prepare();
else if (args[0] === 'browser' && args.length === 2) {
  const browser = z.enum(browsers).parse(args[1]);
  await rm(join(resultsDirectory, `${browser}.json`), { force: true });
  await execute([`--project=${browser}`], browser);
} else if (args[0] === 'finalize' && args.length === 1) await finalize();
else {
  assert(
    !['prepare', 'browser', 'finalize'].includes(args[0] ?? ''),
    'Неверные аргументы test:e2e',
  );
  await prepare();
  await execute(args);
  if (args.length === 0) await finalize();
}
