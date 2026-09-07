export function isAssetPath(path: string): boolean {
  return /^(?:assets\/(?:images|audio\/tt)|icons)\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|mp3|png|svg)$/.test(
    path,
  );
}

export function assertAppBase(base: string): void {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) {
    throw new Error(`Ожидается абсолютный путь base с завершающим /: ${base}`);
  }
}

export function resolveAssetUrl(path: string, base: string): string {
  if (!isAssetPath(path)) throw new Error(`Недопустимый путь ресурса: ${path}`);
  assertAppBase(base);
  return base + path;
}
