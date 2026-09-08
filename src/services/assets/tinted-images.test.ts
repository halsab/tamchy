import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, flush } from '../../../tests/helpers/browser.ts';
import { createTintedImageService } from './tinted-images.ts';

const path = 'assets/images/shapes/shape-circle.png';
const pixel = () => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([217, 67, 67, 128]),
});
function setup(maxCacheBytes = 8) {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  const processor = { run: vi.fn(async () => pixel()), dispose: vi.fn() };
  const service = createTintedImageService({
    fetch: fetcher,
    resolveUrl: (path) => '/tamchy/' + path,
    processor,
    maxCacheBytes,
  });
  return { service, processor, fetcher, controller: new AbortController() };
}
afterEach(() => vi.useRealTimers());

describe('подготовка перекрашенных PNG', () => {
  it('экран получает готовые пиксели; ошибка изображения сбрасывает только этот цвет', async () => {
    const s = setup();
    expect(s.service.get(path, '#D94343')).toBeUndefined();
    const red = await s.service.prepare(path, '#D94343', s.controller.signal);
    const white = await s.service.prepare(path, '#FFFFFF', s.controller.signal);
    expect(s.service.get(path, '#d94343')).toBe(red);
    s.service.invalidate(path, '#d94343');
    expect(s.service.get(path, '#D94343')).toBeUndefined();
    expect(s.service.get(path, '#FFFFFF')).toBe(white);
    await s.service.prepare(path, '#D94343', s.controller.signal);
    expect(s.processor.run).toHaveBeenCalledTimes(3);
    s.service.dispose();
  });
  it('ожидает обработку, учитывает base и переиспользует готовый цвет', async () => {
    const s = setup();
    const processing = deferred<ReturnType<typeof pixel>>();
    s.processor.run.mockReturnValueOnce(processing.promise);
    let ready = false;
    const pending = s.service
      .prepare(path, '#D94343', s.controller.signal)
      .then((result) => {
        ready = true;
        return result;
      });
    await flush();
    expect(ready).toBe(false);
    expect(s.fetcher.mock.calls[0]).toEqual([
      '/tamchy/' + path,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ]);
    processing.resolve(pixel());
    const result = await pending;
    expect(await s.service.prepare(path, '#d94343', s.controller.signal)).toBe(
      result,
    );
    expect(s.processor.run).toHaveBeenCalledTimes(1);
    s.service.dispose();
    expect(s.service.cacheBytes()).toBe(0);
  });

  it('LRU ограничен байтами; вытеснение не портит уже выданные пиксели', async () => {
    const s = setup();
    const red = await s.service.prepare(path, '#D94343', s.controller.signal);
    await s.service.prepare(path, '#FFFFFF', s.controller.signal);
    await s.service.prepare(path, '#D94343', s.controller.signal);
    await s.service.prepare(path, '#222625', s.controller.signal);
    expect(s.service.cacheBytes()).toBe(8);
    await s.service.prepare(path, '#FFFFFF', s.controller.signal);
    expect(s.processor.run).toHaveBeenCalledTimes(4);
    expect([...red.data]).toEqual([217, 67, 67, 128]);
    s.service.dispose();
  });

  it('отмена и поздний ответ не создают готовый результат; повтор работает', async () => {
    const s = setup();
    const processing = deferred<ReturnType<typeof pixel>>();
    s.processor.run.mockReturnValueOnce(processing.promise);
    const pending = s.service.prepare(path, '#D94343', s.controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await flush();
    s.controller.abort();
    await rejected;
    processing.resolve(pixel());
    await flush();
    expect(s.service.cacheBytes()).toBe(0);
    await s.service.prepare(path, '#D94343', new AbortController().signal);
    expect(s.processor.run).toHaveBeenCalledTimes(2);
    s.service.dispose();
  });

  it('15 секунд ограничивают и загрузку, и обработку; доступен явный повтор', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.processor.run.mockReturnValueOnce(new Promise(() => {}));
    const pending = s.service.prepare(path, '#D94343', s.controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'load' });
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(s.service.cacheBytes()).toBe(0);
    await s.service.prepare(path, '#D94343', s.controller.signal);
    s.service.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('поздний callback не обходит дедлайн, даже если таймер ещё не исполнился', async () => {
    let now = 0;
    const processing = deferred<ReturnType<typeof pixel>>();
    const service = createTintedImageService({
      fetch: async () => new Response(new Uint8Array([1, 2, 3])),
      resolveUrl: (value) => value,
      processor: { run: () => processing.promise, dispose: () => {} },
      now: () => now,
    });
    const pending = service.prepare(
      path,
      '#D94343',
      new AbortController().signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'load' });
    await flush();
    now = 15000;
    processing.resolve(pixel());
    await rejected;
    expect(service.cacheBytes()).toBe(0);
    service.dispose();
  });

  it('ошибки, недопустимые пути и dispose не оставляют кэш и работу', async () => {
    const s = setup();
    await expect(
      s.service.prepare('../master.png', '#FFFFFF', s.controller.signal),
    ).rejects.toThrow();
    await expect(
      s.service.prepare(path, 'red', s.controller.signal),
    ).rejects.toThrow();
    expect(s.fetcher).not.toHaveBeenCalled();
    s.fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      s.service.prepare(path, '#FFFFFF', s.controller.signal),
    ).rejects.toMatchObject({ reason: 'load' });
    s.processor.run.mockRejectedValueOnce(new Error('details'));
    await expect(
      s.service.prepare(path, '#FFFFFF', s.controller.signal),
    ).rejects.toMatchObject({ reason: 'decode' });
    s.service.dispose();
    expect(s.processor.dispose).toHaveBeenCalledOnce();
    await expect(
      s.service.prepare(path, '#FFFFFF', s.controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
