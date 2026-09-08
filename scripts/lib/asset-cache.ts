import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readGenerated, writeGenerated } from './generated-files.ts';

const manifestPath = '.cache/assets/manifest.json';
const hash = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
const schema = z.record(
  z.string(),
  z.strictObject({ key: z.string(), sha256: z.string() }),
);

export async function createAssetCache(root: string, fingerprint: string) {
  let entries: z.infer<typeof schema> = {};
  try {
    entries = schema.parse(
      JSON.parse((await readGenerated(root, manifestPath)).toString()),
    );
  } catch (error) {
    if (
      !(error instanceof SyntaxError) &&
      !(error instanceof z.ZodError) &&
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    )
      throw error;
  }
  let reused = 0;
  let generated = 0;
  return {
    async prepare(
      path: string,
      input: Buffer,
      generate: () => Promise<Buffer>,
      validate: (data: Buffer) => Promise<void>,
    ) {
      const key = hash(JSON.stringify([fingerprint, path, hash(input)]));
      const entry = entries[path];
      if (entry?.key === key) {
        let cached: Buffer | undefined;
        try {
          cached = await readGenerated(root, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (cached && hash(cached) === entry.sha256) {
          await validate(cached);
          reused++;
          return cached;
        }
      }
      const data = await generate();
      await validate(data);
      await writeGenerated(root, path, data);
      entries[path] = { key, sha256: hash(data) };
      generated++;
      return data;
    },
    async save() {
      await writeGenerated(
        root,
        manifestPath,
        Buffer.from(JSON.stringify(entries, null, 2) + '\n'),
      );
      return { reused, generated };
    },
  };
}
export type AssetCache = Awaited<ReturnType<typeof createAssetCache>>;
