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
    execFileSync(
      process.execPath,
      [resolve('node_modules/vite/bin/vite.js'), 'build'],
      { cwd: root, env: { ...process.env, VITE_BASE: base }, stdio: 'pipe' },
    );
    await measureBudgets(await inspectArtifact(root, base));
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
