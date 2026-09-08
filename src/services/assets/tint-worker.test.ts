import { describe, expect, it, vi } from 'vitest';
import { createTintWorker, type WorkerPort } from './tint-worker.ts';

function setup() {
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const create = vi.fn(() => port);
  return { port, create, worker: createTintWorker(create) };
}
const request = () => ({
  path: 'assets/images/shapes/shape-circle.png',
  hex: '#D94343',
  png: new Uint8Array([1, 2, 3]),
});
const pixels = () => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([217, 67, 67, 255]),
});

describe('жизненный цикл PNG worker', () => {
  it('запускается лениво, связывает ответы по ID и передаёт буферы', async () => {
    const s = setup();
    expect(s.create).not.toHaveBeenCalled();
    const a = s.worker.run(request(), new AbortController().signal);
    const b = s.worker.run(request(), new AbortController().signal);
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(s.port.postMessage).toHaveBeenCalledTimes(2);
    s.port.onmessage!({ data: { id: 2, pixels: pixels() } } as MessageEvent);
    expect((await b).data[0]).toBe(217);
    s.port.onmessage!({ data: { id: 1, pixels: pixels() } } as MessageEvent);
    await a;
    s.worker.dispose();
    expect(s.port.terminate).toHaveBeenCalledOnce();
  });

  it('отменённый запрос не мешает другому, поздний ответ игнорируется', async () => {
    const s = setup();
    const controller = new AbortController();
    const a = s.worker.run(request(), controller.signal);
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const b = s.worker.run(request(), new AbortController().signal);
    controller.abort();
    await rejected;
    s.port.onmessage!({ data: { id: 1, pixels: pixels() } } as MessageEvent);
    expect(s.port.terminate).not.toHaveBeenCalled();
    s.port.onmessage!({ data: { id: 2, pixels: pixels() } } as MessageEvent);
    await b;
    s.worker.dispose();
  });

  it('последняя отмена останавливает worker; ошибка допускает новый запуск', async () => {
    const s = setup();
    const controller = new AbortController();
    const pending = s.worker.run(request(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejected;
    expect(s.port.terminate).toHaveBeenCalledOnce();
    const retry = s.worker.run(request(), new AbortController().signal);
    const failed = expect(retry).rejects.toMatchObject({ reason: 'decode' });
    s.port.onerror!({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    await failed;
    expect(s.create).toHaveBeenCalledTimes(2);
    s.worker.dispose();
    await expect(
      s.worker.run(request(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
