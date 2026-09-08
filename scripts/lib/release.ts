import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import project from '../../package.json' with { type: 'json' };
import { inspectArtifact, measureBudgets } from './artifact.ts';

export const releaseSchema = z.strictObject({
  schema: z.literal(1),
  base: z.enum(['/', '/tamchy/']),
  release: z.string().regex(/^[a-f0-9]{20}$/),
  version: z.string().min(1),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  dirty: z.boolean(),
  e2e: z.enum(['pending', 'filtered', 'full']),
  files: z
    .array(
      z.strictObject({
        path: z
          .string()
          .regex(
            /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*(?:\.[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/,
          )
          .refine((path) => path === path.trim(), 'Пробельные символы в пути'),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1),
  budgets: z.strictObject({
    js: z.number(),
    css: z.number(),
    firstScreen: z.number(),
    complete: z.number(),
    illustration: z.number(),
    neutralIllustration: z.number(),
  }),
});
export type ReleaseReport = z.infer<typeof releaseSchema>;
export const sha256 = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export const releaseDirectory = (base: string) =>
  resolve('.release', base === '/' ? 'root' : 'subpath');

export async function snapshotFiles(
  dist: string,
): Promise<ReleaseReport['files']> {
  const files: ReleaseReport['files'] = [];
  async function walk(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      assert(!entry.isSymbolicLink(), `Недопустимая ссылка: ${path}`);
      if (entry.isDirectory())
        await walk(join(directory, entry.name), `${path}/`);
      else {
        assert(entry.isFile(), `Недопустимый файл: ${path}`);
        const bytes = await readFile(join(directory, entry.name));
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(dist, '');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function captureRelease(base: string): Promise<ReleaseReport> {
  const artifact = await inspectArtifact(process.cwd(), base);
  return releaseSchema.parse({
    schema: 1,
    base,
    release: artifact.metadata.release,
    version: project.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    dirty: Boolean(
      execFileSync(
        'git',
        ['status', '--porcelain', '--untracked-files=normal'],
        { encoding: 'utf8' },
      ).trim(),
    ),
    e2e: 'pending',
    files: await snapshotFiles(artifact.dist),
    budgets: await measureBudgets(artifact),
  });
}

export async function verifyRelease(
  dist: string,
  input: ReleaseReport,
  base: string,
  commit?: string,
  requireFull = true,
) {
  const report = releaseSchema.parse(input);
  assert.equal(report.base, base, 'Неверная base артефакта');
  if (requireFull)
    assert.equal(report.e2e, 'full', 'Нужен полный успешный test:e2e');
  if (commit) {
    assert.equal(report.commit, commit, 'Другой коммит артефакта');
    assert(!report.dirty, 'Незакоммиченные изменения в артефакте CI');
  }
  assert.deepEqual(
    await snapshotFiles(dist),
    report.files,
    'Изменены файлы проверенного артефакта',
  );
  const metadata = JSON.parse(
    await readFile(join(dist, 'offline-manifest.json'), 'utf8'),
  ) as { base: string; release: string };
  assert.equal(metadata.base, base, 'Неверная base метаданных');
  assert.equal(metadata.release, report.release, 'Другой выпуск');
}

export async function preserveRelease(
  dist: string,
  destination: string,
  report: ReleaseReport,
) {
  await verifyRelease(dist, report, report.base, undefined, false);
  await mkdir(destination, { recursive: true });
  await cp(dist, join(destination, 'dist'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await verifyRelease(
    join(destination, 'dist'),
    report,
    report.base,
    undefined,
    false,
  );
  await writeFile(
    join(destination, 'release.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}

export async function readRelease(path: string) {
  return releaseSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
