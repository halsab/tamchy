import { assetUrl } from './asset-url.ts';
import {
  createPendingLoads,
  fetchResource,
  resourceStep,
} from './resource-loading.ts';

export type ImageBoundary = {
  fetch: typeof fetch;
  resolveUrl: (path: string) => string;
  createImage: () => HTMLImageElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

export function createImageService(boundary: Partial<ImageBoundary> = {}) {
  const environment: ImageBoundary = {
    fetch: (...args) => fetch(...args),
    resolveUrl: assetUrl,
    createImage: () => new Image(),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    ...boundary,
  };
  const ready = new Map<string, HTMLImageElement>();
  const loads = createPendingLoads(async (path, signal) => {
    const cached = ready.get(path);
    if (cached) return cached;
    const response = await fetchResource(
      environment.fetch,
      environment.resolveUrl(path),
      signal,
    );
    const blob = await resourceStep(() => response.blob(), signal, 'load');
    const image = environment.createImage();
    const url = environment.createObjectURL(blob);
    try {
      image.src = url;
      await resourceStep(() => image.decode(), signal, 'decode');
      ready.set(path, image);
      return image;
    } finally {
      if (ready.get(path) !== image) {
        image.src = '';
        environment.revokeObjectURL(url);
      }
    }
  });
  return {
    prepare: loads.run,
    get: (path: string) => ready.get(path),
    invalidate(path: string) {
      const image = ready.get(path);
      if (!image) return;
      ready.delete(path);
      environment.revokeObjectURL(image.src);
      image.src = '';
    },
    dispose() {
      loads.dispose();
      for (const image of ready.values()) {
        environment.revokeObjectURL(image.src);
        image.src = '';
      }
      ready.clear();
    },
  };
}

export type ImageService = ReturnType<typeof createImageService>;
