import { assetUrl } from './asset-url.ts';
import { createPixelCache } from './pixel-cache.ts';
import {
  createPendingLoads,
  fetchResource,
  ResourceError,
  resourceStep,
} from './resource-loading.ts';
import { createTintWorker, type TintProcessor } from './tint-worker.ts';
import type { TintedPixels } from './tint.ts';

type TintBoundary = {
  fetch: typeof fetch;
  resolveUrl: (path: string) => string;
  processor: TintProcessor;
  maxCacheBytes: number;
  now: () => number;
};

export function createTintedImageService(boundary: Partial<TintBoundary> = {}) {
  const environment: TintBoundary = {
    fetch: (...args) => fetch(...args),
    resolveUrl: assetUrl,
    processor: createTintWorker(),
    maxCacheBytes: 24 * 1024 * 1024,
    now: () => performance.now(),
    ...boundary,
  };
  const cache = createPixelCache<TintedPixels>(environment.maxCacheBytes);
  const loads = createPendingLoads(async (key, signal) => {
    const cached = cache.get(key);
    if (cached) return cached;
    const [path, hex] = key.split('|') as [string, string];
    const controller = new AbortController();
    const deadline = environment.now() + 15000;
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    try {
      const response = await fetchResource(
        environment.fetch,
        environment.resolveUrl(path),
        controller.signal,
      );
      const buffer = await resourceStep(
        () => response.arrayBuffer(),
        controller.signal,
        'load',
      );
      const result = await resourceStep(
        () =>
          environment.processor.run(
            { path, hex, png: new Uint8Array(buffer) },
            controller.signal,
          ),
        controller.signal,
        'decode',
      );
      signal.throwIfAborted();
      if (environment.now() >= deadline) {
        controller.abort();
        throw new ResourceError('load');
      }
      cache.put(key, result);
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (timedOut) throw new ResourceError('load');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  });
  return {
    prepare(path: string, hex: string, signal: AbortSignal) {
      if (
        !/^assets\/images\/(?:shapes\/shape-|color-objects\/color-object-)[a-z-]+\.png$/.test(
          path,
        ) ||
        !/^#[0-9a-f]{6}$/i.test(hex)
      ) {
        return Promise.reject(new ResourceError('load'));
      }
      return loads.run(`${path}|${hex.toUpperCase()}`, signal);
    },
    cacheBytes: cache.bytes,
    dispose() {
      loads.dispose();
      environment.processor.dispose();
      cache.clear();
    },
  };
}

// Пиксели в кэше доступны только для чтения; каждый экран рисует в собственный canvas.
export function drawTintedImage(
  canvas: HTMLCanvasElement,
  pixels: TintedPixels,
) {
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!context) throw new ResourceError('decode');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  context.putImageData(
    new ImageData(pixels.data, pixels.width, pixels.height, {
      colorSpace: 'srgb',
    }),
    0,
    0,
  );
}
