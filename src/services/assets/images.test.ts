import { describe, expect, it } from 'vitest';
import {
  browserImages,
  deferred,
  flush,
  successfulFetch,
} from '../../../tests/helpers/browser.ts';
import { createImageService } from './images.ts';
import { resolveAssetUrl } from './paths.ts';

const path = 'assets/images/numbers/count-apple.webp';
function setup() {
  const boundary = browserImages();
  const fetch = successfulFetch();
  const service = createImageService({
    ...boundary,
    fetch,
    resolveUrl: (path) => resolveAssetUrl(path, '/tamchy/'),
  });
  const controller = new AbortController();
  return { ...boundary, fetch, service, controller };
}

describe('подготовка изображений', () => {
  it('готово только после decode; сохраняет результат и учитывает base', async () => {
    const s = setup();
    const decoding = deferred<void>();
    s.createImage.mockImplementationOnce(
      () => ({ src: '', decode: () => decoding.promise }) as HTMLImageElement,
    );
    let ready = false;
    const pending = s.service.prepare(path, s.controller.signal).then(() => {
      ready = true;
    });
    await flush();
    expect(ready).toBe(false);
    expect(s.fetch.mock.calls[0]?.[0]).toBe('/tamchy/' + path);
    decoding.resolve();
    await pending;
    expect(s.service.get(path)?.src).toMatch(/^blob:/);
    await s.service.prepare(path, s.controller.signal);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.service.dispose();
    expect(s.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(s.service.get(path)).toBeUndefined();
  });

  it.each(['http', 'decode'] as const)(
    'ошибка %s допускает новую попытку',
    async (kind) => {
      const s = setup();
      if (kind === 'http')
        s.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      else
        s.createImage.mockImplementationOnce(
          () =>
            ({
              src: '',
              decode: async () => {
                throw new Error('private');
              },
            }) as unknown as HTMLImageElement,
        );
      await expect(
        s.service.prepare(path, s.controller.signal),
      ).rejects.toMatchObject({ reason: kind === 'http' ? 'load' : 'decode' });
      expect(s.service.get(path)).toBeUndefined();
      await s.service.prepare(path, s.controller.signal);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      s.service.dispose();
    },
  );

  it('отмена освобождает URL и игнорирует позднее декодирование', async () => {
    const s = setup();
    const decoding = deferred<void>();
    s.createImage.mockImplementationOnce(
      () => ({ src: '', decode: () => decoding.promise }) as HTMLImageElement,
    );
    const pending = s.service.prepare(path, s.controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await flush();
    s.controller.abort();
    await rejected;
    expect(s.revokeObjectURL).toHaveBeenCalledTimes(1);
    decoding.resolve();
    await flush();
    expect(s.service.get(path)).toBeUndefined();
    await s.service.prepare(path, new AbortController().signal);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    s.service.dispose();
  });

  it('объединяет повтор с тем же signal; dispose отменяет зависший fetch', async () => {
    const s = setup();
    const network = deferred<Response>();
    s.fetch.mockReturnValueOnce(network.promise);
    const a = s.service.prepare(path, s.controller.signal);
    const b = s.service.prepare(path, s.controller.signal);
    const rejected = Promise.all([
      expect(a).rejects.toMatchObject({ name: 'AbortError' }),
      expect(b).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.service.dispose();
    await rejected;
    expect(s.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    network.resolve(new Response('late'));
    await flush();
    expect(s.createImage).not.toHaveBeenCalled();
  });
});
