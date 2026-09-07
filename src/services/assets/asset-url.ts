import { resolveAssetUrl } from './paths.ts';

export function assetUrl(path: string): string {
  return resolveAssetUrl(path, import.meta.env.BASE_URL);
}
