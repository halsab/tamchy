import { ResourceError } from './resource-loading.ts';
import type { TintedPixels } from './tint.ts';
import type { TintReply, TintRequest } from './tint.worker.ts';

export type WorkerPort = {
  onmessage: ((event: MessageEvent<TintReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage: (message: TintRequest, transfer: Transferable[]) => void;
  terminate: () => void;
};

export function createTintWorker(
  createWorker: () => WorkerPort = () =>
    new Worker(new URL('./tint.worker.ts', import.meta.url), {
      type: 'module',
    }),
) {
  let port: WorkerPort | undefined;
  let nextId = 0;
  let disposed = false;
  const pending = new Map<
    number,
    { finish: (error?: Error, pixels?: TintedPixels) => void }
  >();
  function stop() {
    if (!port) return;
    port.onmessage = null;
    port.onerror = null;
    port.onmessageerror = null;
    port.terminate();
    port = undefined;
  }
  function fail() {
    stop();
    for (const { finish } of pending.values())
      finish(new ResourceError('decode'));
  }
  function start() {
    if (port) return port;
    port = createWorker();
    port.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if ('error' in data) job.finish(new ResourceError('decode'));
      else job.finish(undefined, data.pixels);
    };
    port.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    port.onmessageerror = fail;
    return port;
  }
  return {
    run(
      request: Omit<TintRequest, 'id'>,
      signal: AbortSignal,
    ): Promise<TintedPixels> {
      if (disposed || signal.aborted)
        return Promise.reject(
          new DOMException('Операция отменена', 'AbortError'),
        );
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const finish = (error?: Error, pixels?: TintedPixels) => {
          signal.removeEventListener('abort', abort);
          pending.delete(id);
          if (error) reject(error);
          else resolve(pixels!);
        };
        const abort = () => {
          finish(new DOMException('Операция отменена', 'AbortError'));
          // Последняя отмена освобождает также декодированные мастера и очередь worker.
          if (!pending.size) stop();
        };
        signal.addEventListener('abort', abort, { once: true });
        pending.set(id, { finish });
        try {
          start().postMessage({ ...request, id }, [request.png.buffer]);
        } catch {
          fail();
        }
      });
    },
    dispose() {
      disposed = true;
      stop();
      for (const { finish } of pending.values())
        finish(new DOMException('Операция отменена', 'AbortError'));
    },
  };
}

export type TintProcessor = ReturnType<typeof createTintWorker>;
