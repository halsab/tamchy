import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { writeGenerated } from './lib/generated-files.ts';
import { readContent } from './lib/read-content.ts';
import { icons, resourcePaths } from './lib/resources.ts';
import { prepareNeutralAssets } from './lib/neutral-png.ts';
import { readV2Content, v2ResourcePaths } from './lib/v2-content.ts';
import graphics from '../src/content/v2/graphics.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');
const background = '#FFF9F2';
const illustrationSize = 768;
const illustrationBudget = 150 * 1024;

async function hashes(paths: string[]) {
  return Promise.all(
    paths.map(async (path) =>
      createHash('sha256')
        .update(await readFile(resolve(root, path)))
        .digest('hex'),
    ),
  );
}

try {
  const resources = process.argv.includes('--v2')
    ? v2ResourcePaths(await readV2Content(root))
    : resourcePaths((await readContent(root)).catalog);
  const images = resources.images
    .filter((path) => path.endsWith('.webp'))
    .map((output) => ({
      source: output
        .replace('assets/images/', 'assets-source/')
        .replace(/\.webp$/, '.png'),
      output,
    }));
  const iconMaster = 'assets-source/icons/app-icon-master.png';
  const masters = [...images.map(({ source }) => source), iconMaster];
  const before = await hashes(masters);
  masters.forEach((source, index) => {
    if (
      graphics.find((entry) => entry.source === source)?.sha256 !==
      before[index]
    )
      throw new Error(`SHA-256 мастера не совпадает с реестром: ${source}`);
  });
  let preparationError: Error | undefined;
  try {
    for (const { source, output } of images) {
      const input = await readFile(resolve(root, source));
      const metadata = await sharp(input).metadata();
      if (
        metadata.format !== 'png' ||
        metadata.width !== 1254 ||
        metadata.height !== 1254 ||
        !metadata.hasAlpha
      ) {
        throw new Error(
          `Мастер не соответствует реестру PNG RGBA 1254×1254: ${source}`,
        );
      }
      const data = await sharp(input)
        .resize({
          width: illustrationSize,
          height: illustrationSize,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: 84,
          alphaQuality: 100,
          effort: 6,
          smartSubsample: true,
        })
        .toBuffer();
      const derivative = await sharp(data).metadata();
      const stats = await sharp(data).stats();
      const alpha = stats.channels[3];
      if (
        data.length > illustrationBudget ||
        derivative.format !== 'webp' ||
        derivative.width !== illustrationSize ||
        derivative.height !== illustrationSize ||
        !derivative.hasAlpha ||
        !alpha ||
        alpha.min !== 0 ||
        alpha.max !== 255
      ) {
        throw new Error(
          `Производная не прошла проверку размера, бюджета или прозрачности: ${output}`,
        );
      }
      await writeGenerated(root, `public/${output}`, data);
      console.log(
        `${output}: ${derivative.width}×${derivative.height}, ${(data.length / 1024).toFixed(1)} КиБ, прозрачность сохранена`,
      );
    }
    const input = await readFile(resolve(root, iconMaster));
    const metadata = await sharp(input).metadata();
    if (
      metadata.format !== 'png' ||
      metadata.width !== 1254 ||
      metadata.height !== 1254 ||
      metadata.hasAlpha
    )
      throw new Error('Мастер иконки должен быть непрозрачным PNG 1254×1254');
    for (const icon of icons) {
      let pipeline = sharp(input).resize(icon.size, icon.size);
      if (icon.path.includes('maskable')) {
        // Весь квадрат 288×288 лежит внутри безопасного круга радиусом 40% от 512.
        const artwork = await sharp(input).resize(288, 288).png().toBuffer();
        pipeline = sharp({
          create: { width: 512, height: 512, channels: 3, background },
        }).composite([{ input: artwork, gravity: 'centre' }]);
      }
      const data = await pipeline
        .flatten({ background })
        .removeAlpha()
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: true,
          colours: 256,
          dither: 1,
        })
        .toBuffer();
      const derivative = await sharp(data).metadata();
      if (
        data.length > illustrationBudget ||
        derivative.format !== 'png' ||
        derivative.width !== icon.size ||
        derivative.height !== icon.size ||
        derivative.hasAlpha
      )
        throw new Error(`Некорректная иконка: ${icon.path}`);
      await writeGenerated(root, `public/${icon.path}`, data);
      console.log(
        `${icon.path}: ${icon.size}×${icon.size}, PNG без прозрачности`,
      );
    }
  } catch (error) {
    preparationError =
      error instanceof Error ? error : new Error(String(error));
  }
  const after = await hashes(masters);
  if (before.some((hash, index) => hash !== after[index]))
    throw new Error('Изменились хеши мастер-файлов', {
      cause: preparationError,
    });
  console.log(
    `SHA-256: все ${masters.length} мастер-PNG остались неизменными.`,
  );
  if (preparationError) throw preparationError;
  const neutral = await prepareNeutralAssets(root);
  console.log(
    `Подготовлены ${neutral.length} нейтральных PNG без изменения RGBA; всего ${neutral.reduce((total, { bytes }) => total + bytes, 0)} байт, максимум ${Math.max(...neutral.map(({ bytes }) => bytes))} байт (лимит 300 КиБ).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
