import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function writeGenerated(
  root: string,
  relativePath: string,
  data: Uint8Array,
) {
  let directory = root;
  for (const segment of dirname(relativePath).split('/')) {
    directory = join(directory, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Небезопасный каталог: ${directory}`);
  }
  const output = join(root, relativePath);
  try {
    const info = await lstat(output);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Нельзя перезаписать: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}
