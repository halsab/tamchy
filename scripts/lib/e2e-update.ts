import {
  cp,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectArtifact, measureBudgets } from './artifact.ts';
import { readContent } from './read-content.ts';

export function createLegacyFixture(base: string) {
  return createHistoricalFixture(
    base,
    '5a2aece6a3e53e9792ae7867c47de488a9d5941b',
    'mvp',
  );
}

export function createJuniorFixture(base: string) {
  return createHistoricalFixture(
    base,
    '0837e9087a1d7b112d8be95a9a1b3ac525582afc',
    'junior',
  );
}

async function createHistoricalFixture(
  base: string,
  commit: string,
  name: string,
) {
  const root = await mkdtemp(join(tmpdir(), `tamchy-${name}-`));
  try {
    // Исторический коммит проверяет миграцию настоящего приложения, а не переименованной текущей сборки.
    const source = execFileSync(
      'git',
      [
        'archive',
        commit,
        'src',
        'scripts',
        'index.html',
        'package.json',
        'package-lock.json',
        'vite.config.ts',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    execFileSync('tar', ['-x', '-C', root], { input: source });
    await cp(resolve('public'), join(root, 'public'), { recursive: true });
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    // Vitest задаёт NODE_ENV=test; проверяем релизный React и тот же бюджет, что у выпуска.
    execFileSync(
      process.execPath,
      [resolve('node_modules/vite/bin/vite.js'), 'build'],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: 'production', VITE_BASE: base },
        stdio: 'pipe',
      },
    );
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function createUpdateFixture(base: string) {
  const root = await mkdtemp(join(tmpdir(), 'tamchy-update-'));
  try {
    for (const path of [
      'src',
      'scripts',
      'public',
      'index.html',
      'package.json',
      'package-lock.json',
      'vite.config.ts',
    ])
      await cp(resolve(path), join(root, path), { recursive: true });
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const { catalog, strings } = await readContent(root);
    strings.parents.about += ' Яңа версия.';
    await writeFile(join(root, 'src/content/tt.json'), JSON.stringify(strings));
    const audio = join(
      root,
      'public',
      catalog.audio.find((clip) => clip.id === 'color.red')!.path,
    );
    // В изолированной B добавляем пустой ID3v2-тег: голос не меняется, байты и ревизия меняются.
    await writeFile(
      audio,
      Buffer.concat([
        Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]),
        await readFile(audio),
      ]),
    );
    // Vitest задаёт NODE_ENV=test; проверяем релизный React и тот же бюджет, что у выпуска.
    execFileSync(
      process.execPath,
      [resolve('node_modules/vite/bin/vite.js'), 'build'],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: 'production', VITE_BASE: base },
        stdio: 'pipe',
      },
    );
    await measureBudgets(await inspectArtifact(root, base));
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
