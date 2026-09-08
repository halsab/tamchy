import { readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createUpdateFixture } from '../../scripts/lib/e2e-update.ts';
import { inspectArtifact, measureBudgets } from '../../scripts/lib/artifact.ts';

it('итоговый PWA /tamchy/: один перечень и отклонение повреждённого артефакта', async () => {
  const base = '/tamchy/';
  const root = await createUpdateFixture(base);
  try {
    const artifact = await inspectArtifact(root, base);
    expect(
      artifact.metadata.entries.filter((entry) => entry.url.endsWith('.mp3')),
    ).toHaveLength(189);
    expect(
      artifact.metadata.entries.filter((entry) => entry.url.endsWith('.webp')),
    ).toHaveLength(43);
    const illustrations = artifact.files.filter(
      (file) =>
        /\.(webp|png|svg)$/.test(file) &&
        !/^assets\/images\/(shapes|color-objects)\//.test(file),
    );
    const imageSizes = await Promise.all(
      illustrations.map(
        async (file) => (await stat(join(artifact.dist, file))).size,
      ),
    );
    const largestImage = Math.max(...imageSizes);
    expect(largestImage).toBeGreaterThan(0);
    expect(largestImage).toBeLessThanOrEqual(150 * 1024);
    await expect(measureBudgets(artifact)).resolves.toMatchObject({
      illustration: largestImage,
    });
    const neutral = artifact.files.filter((file) =>
      /^assets\/images\/(?:shapes|color-objects)\/.+\.png$/.test(file),
    );
    expect(neutral).toHaveLength(12);
    const neutralPath = join(artifact.dist, neutral[0]!);
    const neutralBytes = await readFile(neutralPath);
    try {
      await writeFile(neutralPath, Buffer.alloc(300 * 1024));
      await expect(measureBudgets(artifact)).resolves.toMatchObject({
        neutralIllustration: 300 * 1024,
      });
      await writeFile(neutralPath, Buffer.alloc(300 * 1024 + 1));
      await expect(measureBudgets(artifact)).rejects.toThrow(
        'neutralIllustration',
      );
    } finally {
      await writeFile(neutralPath, neutralBytes);
    }
    const imagePath = join(artifact.dist, illustrations[0]!);
    const image = await readFile(imagePath);
    try {
      // Здесь проверяем байтовый бюджет; целостность ресурсов проверяется отдельно.
      await writeFile(imagePath, Buffer.alloc(150 * 1024));
      await expect(measureBudgets(artifact)).resolves.toMatchObject({
        illustration: 150 * 1024,
      });
      await writeFile(imagePath, Buffer.alloc(150 * 1024 + 1));
      await expect(measureBudgets(artifact)).rejects.toThrow(
        'illustration: 153601 > 153600 байт',
      );
    } finally {
      await writeFile(imagePath, image);
    }
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
}, 30_000);
