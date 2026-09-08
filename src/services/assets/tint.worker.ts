import { decodeNeutralPng } from './neutral-png.ts';
import { createPixelCache } from './pixel-cache.ts';
import {
  tintNeutralPixels,
  type NeutralPixels,
  type TintedPixels,
} from './tint.ts';

export type TintRequest = {
  id: number;
  path: string;
  hex: string;
  png: Uint8Array<ArrayBuffer>;
};
export type TintReply =
  { id: number; pixels: TintedPixels } | { id: number; error: true };

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<TintRequest>) => void;
  postMessage: (message: TintReply, transfer: Transferable[]) => void;
};
const cache = createPixelCache<NeutralPixels>(8 * 1024 * 1024);
scope.onmessage = ({ data: { id, path, hex, png } }) => {
  try {
    let source = cache.get(path);
    if (!source) {
      source = decodeNeutralPng(png);
      cache.put(path, source);
    }
    const pixels = tintNeutralPixels(source, hex);
    scope.postMessage({ id, pixels }, [pixels.data.buffer]);
  } catch {
    scope.postMessage({ id, error: true }, []);
  }
};
