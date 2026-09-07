import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createUpdateFixture } from '../../scripts/lib/e2e-update.ts';
import { inspectArtifact, measureBudgets } from '../../scripts/lib/artifact.ts';

it.each(['/', '/tamchy/'])(
  'итоговый PWA %s: один перечень и отклонение повреждённого артефакта',
  async (base) => {
    const root = await createUpdateFixture(base);
    try {
      const artifact = await inspectArtifact(root, base);
      expect(
        artifact.metadata.entries.filter((entry) => entry.url.endsWith('.mp3')),
      ).toHaveLength(30);
      expect(
        artifact.metadata.entries.filter((entry) =>
          entry.url.endsWith('.webp'),
        ),
      ).toHaveLength(10);
      await expect(measureBudgets(artifact)).resolves.toMatchObject({
        illustration: 150650,
      });
      const path = join(root, 'dist', artifact.metadata.entries[0]!.url);
      const bytes = await readFile(path);
      await writeFile(path, 'corrupted');
      await expect(inspectArtifact(root, base)).rejects.toThrow();
      await writeFile(path, bytes);
      await writeFile(join(root, 'dist/.gitkeep'), 'forbidden');
      await expect(inspectArtifact(root, base)).rejects.toThrow('Посторонние');
      await rm(join(root, 'dist/.gitkeep'));
      const helperPath = join(
        root,
        'dist',
        `offline-worker-${artifact.metadata.release}.js`,
      );
      const helper = await readFile(helperPath, 'utf8');
      await writeFile(helperPath, helper + '\n// changed');
      await expect(inspectArtifact(root, base)).rejects.toThrow('worker');
      await writeFile(helperPath, helper);
      const swPath = join(root, 'dist/sw.js');
      const sw = await readFile(swPath, 'utf8');
      await writeFile(
        swPath,
        sw.replace(/precacheAndRoute\(\[\{[^}]+\},/, 'precacheAndRoute(['),
      );
      await expect(inspectArtifact(root, base)).rejects.toThrow('precache');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
