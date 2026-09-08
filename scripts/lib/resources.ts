import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Catalog } from '../../src/content/types.ts';
import {
  interactionIds,
  interactionPath,
} from '../../src/content/interactions.ts';

export const icons = [
  { path: 'icons/pwa-192x192.png', size: 192 },
  { path: 'icons/pwa-512x512.png', size: 512 },
  { path: 'icons/pwa-maskable-512x512.png', size: 512 },
  { path: 'icons/apple-touch-icon.png', size: 180 },
] as const;

export function resourcePaths(catalog: Catalog) {
  const images = new Set<string>();
  const audio: string[] = [];
  for (const category of catalog.categories) {
    images.add(category.image);
    for (const item of category.items) {
      audio.push(item.labelAudio, item.promptAudio);
      if (item.kind === 'animal') images.add(item.image);
      if (item.kind === 'number') images.add(item.countImage);
    }
  }
  audio.push(...interactionIds.map(interactionPath));
  return { images: [...images], audio, icons: icons.map(({ path }) => path) };
}

export type ResourceReport = {
  available: string[];
  errors: string[];
  missingAudio: string[];
  resourcesComplete: boolean;
};

async function fileStatus(
  root: string,
  path: string,
): Promise<'available' | 'missing'> {
  let current = root;
  const segments = path.split('/');
  for (const [index, segment] of segments.entries()) {
    let names: string[];
    try {
      names = await readdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw error;
    }
    if (!names.includes(segment)) {
      if (names.some((name) => name.toLowerCase() === segment.toLowerCase())) {
        throw new Error(`Регистр пути не совпадает: ${path}`);
      }
      return 'missing';
    }
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Симлинк недопустим: ${path}`);
    if (index < segments.length - 1) {
      if (!info.isDirectory()) throw new Error(`Ожидается каталог: ${path}`);
    } else if (!info.isFile() || info.size === 0) {
      throw new Error(`Ожидается непустой обычный файл: ${path}`);
    }
  }
  return 'available';
}

export async function inspectResources(
  root: string,
  catalog: Catalog,
): Promise<ResourceReport> {
  return inspectResourcePaths(root, resourcePaths(catalog));
}

export async function inspectResourcePaths(
  root: string,
  paths: ReturnType<typeof resourcePaths>,
): Promise<ResourceReport> {
  const available: string[] = [];
  const errors: string[] = [];
  const missingAudio: string[] = [];
  for (const path of [...paths.images, ...paths.icons, ...paths.audio]) {
    try {
      if ((await fileStatus(root, path)) === 'available') available.push(path);
      else if (paths.audio.includes(path)) missingAudio.push(path);
      else errors.push(`Отсутствует обязательный ресурс: ${path}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    available,
    errors,
    missingAudio,
    resourcesComplete: !errors.length && !missingAudio.length,
  };
}

export function assertCompleteContent(report: ResourceReport): void {
  if (report.errors.length || report.missingAudio.length) {
    throw new Error(
      [
        ...report.errors,
        ...report.missingAudio.map(
          (path) => `Отсутствует обязательная запись: ${path}`,
        ),
      ].join('\n'),
    );
  }
}

export function formatResourceReport(report: ResourceReport): string {
  return [
    ...report.errors,
    ...(report.missingAudio.length
      ? [
          `Нет обязательных MP3 (${report.missingAudio.length}):`,
          ...report.missingAudio.map((path) => `  ${path}`),
          'Контент не готов к релизу. Проверка каталога не заменяет validate:content.',
        ]
      : []),
    ...(report.resourcesComplete
      ? [
          'Все обязательные ресурсы присутствуют; это не подтверждает языковую вычитку, декодирование аудио или приёмку MVP.',
        ]
      : []),
  ].join('\n');
}
