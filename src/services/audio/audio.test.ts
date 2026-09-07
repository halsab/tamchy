import { describe, expect, it, vi } from 'vitest';
import {
  browserAudio,
  buffer,
  deferred,
  flush,
  successfulFetch,
} from '../../../tests/helpers/browser.ts';
import { createAudioService } from './audio.ts';

const path = 'assets/audio/tt/colors/color-red-prompt.mp3';
function setup(maxCacheBytes = 8 * 1024 * 1024) {
  const boundary = browserAudio();
  const fetch = successfulFetch();
  const service = createAudioService({ ...boundary, fetch, maxCacheBytes });
  const controller = new AbortController();
  return { ...boundary, fetch, service, controller };
}

function callbacks() {
  return { started: vi.fn(), ended: vi.fn(), failed: vi.fn() };
}

describe('аудиосервис', () => {
  it('создаёт и возобновляет контекст прямо в activate до fetch', async () => {
    const s = setup();
    expect(s.createContext).not.toHaveBeenCalled();
    const activated = s.service.activate();
    expect(s.createContext).toHaveBeenCalledTimes(1);
    expect(s.context.resume).toHaveBeenCalledTimes(1);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(await activated).toBe(true);
    const decoding = deferred<AudioBuffer>();
    s.context.decodeAudioData.mockReturnValueOnce(decoding.promise);
    let ready = false;
    const pending = s.service.prepare(path, s.controller.signal).then(() => {
      ready = true;
    });
    await flush();
    expect(ready).toBe(false);
    expect(s.context.decodeAudioData.mock.calls[0]?.[0].byteLength).toBe(3);
    decoding.resolve(buffer());
    await pending;
    await s.service.prepare(path, s.controller.signal);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.service.dispose();
  });

  it.each(['resolve', 'reject'] as const)(
    'проверяет блокированный resume (%s)',
    async (mode) => {
      const s = setup();
      s.context.resume.mockImplementationOnce(async () => {
        if (mode === 'reject') throw new Error('private');
      });
      expect(await s.service.activate()).toBe(false);
      const cb = callbacks();
      s.service.play(path, s.controller.signal, cb);
      await flush();
      expect(cb.failed).toHaveBeenCalledWith('blocked');
      expect(cb.started).not.toHaveBeenCalled();
      s.service.dispose();
    },
  );

  it('stop не ждёт resume и позднее разрешение не запускает звук', async () => {
    const s = setup();
    const resume = deferred<void>();
    s.context.resume.mockReturnValueOnce(resume.promise);
    void s.service.activate();
    const cb = callbacks();
    s.service.play(path, s.controller.signal, cb);
    s.service.stop();
    s.context.state = 'running';
    resume.resolve();
    await flush();
    expect(s.sources).toHaveLength(0);
    expect(cb.failed).not.toHaveBeenCalled();
    s.service.dispose();
  });

  it('повтор создаёт новый source; stop не равен естественному окончанию', async () => {
    const s = setup();
    await s.service.activate();
    await s.service.prepare(path, s.controller.signal);
    const first = callbacks();
    s.service.play(path, s.controller.signal, first);
    await flush();
    const oldEnd = s.sources[0]!.onended!;
    expect(first.started).toHaveBeenCalledTimes(1);
    const second = callbacks();
    s.service.play(path, s.controller.signal, second);
    await flush();
    expect(s.sources).toHaveLength(2);
    expect(s.sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(s.sources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(s.sources[0]!.onended).toBeNull();
    oldEnd();
    expect(first.ended).not.toHaveBeenCalled();
    expect(s.sources[1]!.buffer).toBe(s.sources[0]!.buffer);
    s.sources[1]!.onended!();
    expect(second.ended).toHaveBeenCalledTimes(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.service.dispose();
  });

  it.each(['http', 'decode'] as const)(
    'сбой %s не остаётся в кэше',
    async (kind) => {
      const s = setup();
      await s.service.activate();
      if (kind === 'http')
        s.fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
      else
        s.context.decodeAudioData.mockRejectedValueOnce(new Error('private'));
      await expect(
        s.service.prepare(path, s.controller.signal),
      ).rejects.toMatchObject({ reason: kind === 'http' ? 'load' : 'decode' });
      await s.service.prepare(path, s.controller.signal);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      s.service.dispose();
    },
  );

  it('отменяет decode логически; новая попытка не получает старый буфер', async () => {
    const s = setup();
    await s.service.activate();
    const decoding = deferred<AudioBuffer>();
    s.context.decodeAudioData.mockReturnValueOnce(decoding.promise);
    const pending = s.service.prepare(path, s.controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await flush();
    s.controller.abort();
    await rejected;
    decoding.resolve(buffer(1000));
    await flush();
    await s.service.prepare(path, new AbortController().signal);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    s.service.dispose();
  });

  it('LRU считает PCM, защищает играющий буфер и освобождает его после stop', async () => {
    const s = setup(800);
    await s.service.activate();
    const second = path.replace('red', 'blue');
    const third = path.replace('red', 'green');
    await s.service.prepare(path, s.controller.signal);
    s.service.play(path, s.controller.signal, callbacks());
    await flush();
    await s.service.prepare(second, s.controller.signal);
    await s.service.prepare(third, s.controller.signal);
    expect(s.service.cacheBytes()).toBe(800);
    await s.service.prepare(path, s.controller.signal);
    expect(s.fetch).toHaveBeenCalledTimes(3);
    await s.service.prepare(second, s.controller.signal);
    expect(s.fetch).toHaveBeenCalledTimes(4);
    s.service.stop();
    expect(s.service.cacheBytes()).toBeLessThanOrEqual(800);
    s.service.dispose();
    expect(s.service.cacheBytes()).toBe(0);
  });

  it('системное прерывание останавливает запись; собственный stop и close не прерывания', async () => {
    const s = setup();
    const interrupted = vi.fn();
    const unsubscribe = s.service.subscribeInterruption(interrupted);
    await s.service.activate();
    s.changeState('running');
    s.service.play(path, s.controller.signal, callbacks());
    await flush();
    s.changeState('interrupted');
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(s.sources[0]!.onended).toBeNull();
    s.service.stop();
    unsubscribe();
    s.service.dispose();
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(s.listeners.size).toBe(0);
  });
});

it('ожидает полный arrayBuffer и считает каналы PCM; вытеснённый буфер загружается снова', async () => {
  const s = setup(1000);
  await s.service.activate();
  const body = deferred<ArrayBuffer>();
  const response = new Response('audio');
  vi.spyOn(response, 'arrayBuffer').mockReturnValueOnce(body.promise);
  s.fetch.mockResolvedValueOnce(response);
  s.context.decodeAudioData.mockResolvedValueOnce(buffer(100, 2));
  const pending = s.service.prepare(path, s.controller.signal);
  await flush();
  expect(s.context.decodeAudioData).not.toHaveBeenCalled();
  body.resolve(new ArrayBuffer(10));
  await pending;
  expect(s.service.cacheBytes()).toBe(800);
  await s.service.prepare(path.replace('red', 'blue'), s.controller.signal);
  expect(s.service.cacheBytes()).toBe(400);
  await s.service.prepare(path, s.controller.signal);
  expect(s.fetch).toHaveBeenCalledTimes(3);
  s.service.dispose();
});

it('буфер больше лимита не сохраняется в кэше, но живёт до конца активной записи', async () => {
  const s = setup(200);
  await s.service.activate();
  const cb = callbacks();
  s.service.play(path, s.controller.signal, cb);
  await flush();
  expect(s.service.cacheBytes()).toBe(0);
  expect(s.sources[0]!.buffer).toMatchObject({ length: 100 });
  await s.service.prepare(path, s.controller.signal);
  expect(s.fetch).toHaveBeenCalledTimes(1);
  s.service.stop();
  await s.service.prepare(path, s.controller.signal);
  expect(s.fetch).toHaveBeenCalledTimes(2);
  s.service.dispose();
});

it('stop отменяет зависший запрос play; повтор получает свежую попытку', async () => {
  const s = setup();
  await s.service.activate();
  const network = deferred<Response>();
  s.fetch.mockReturnValueOnce(network.promise);
  const old = callbacks();
  s.service.play(path, s.controller.signal, old);
  await flush();
  s.service.stop();
  expect(s.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  const next = callbacks();
  s.service.play(path, s.controller.signal, next);
  await flush();
  expect(next.started).toHaveBeenCalledTimes(1);
  network.resolve(new Response('late'));
  await flush();
  expect(old.started).not.toHaveBeenCalled();
  expect(old.ended).not.toHaveBeenCalled();
  expect(old.failed).not.toHaveBeenCalled();
  s.service.dispose();
});

it.each(['throw', 'suspend'] as const)(
  'не сообщает AUDIO_STARTED, если start: %s',
  async (mode) => {
    const s = setup();
    await s.service.activate();
    const original = s.context.createBufferSource.getMockImplementation()!;
    s.context.createBufferSource.mockImplementationOnce(() => {
      const source = original();
      source.start.mockImplementationOnce(() => {
        if (mode === 'throw') throw new Error('private');
        s.context.state = 'suspended';
      });
      return source;
    });
    const cb = callbacks();
    s.service.play(path, s.controller.signal, cb);
    await flush();
    expect(cb.started).not.toHaveBeenCalled();
    expect(cb.failed).toHaveBeenCalledWith('blocked');
    expect(s.sources[0]!.onended).toBeNull();
    s.service.dispose();
  },
);

it('без активации и после dispose сервис не создаёт контекст или запись', async () => {
  const s = setup();
  await expect(
    s.service.prepare(path, s.controller.signal),
  ).rejects.toMatchObject({ reason: 'blocked' });
  expect(s.createContext).not.toHaveBeenCalled();
  s.service.dispose();
  expect(await s.service.activate()).toBe(false);
  s.service.play(path, s.controller.signal, callbacks());
  await expect(
    s.service.prepare(path, s.controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(s.sources).toHaveLength(0);
});
