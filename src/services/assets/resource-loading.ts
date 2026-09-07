export class ResourceError extends Error {
  constructor(readonly reason: 'load' | 'decode' | 'blocked') {
    super(reason);
  }
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Операция отменена', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    // Обработчики остаются у Promise и после отмены: поздний отказ не станет unhandled rejection.
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export async function resourceStep<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  reason: ResourceError['reason'],
): Promise<T> {
  signal.throwIfAborted();
  try {
    const value = await abortable(operation(), signal);
    signal.throwIfAborted();
    return value;
  } catch (error) {
    signal.throwIfAborted();
    throw error instanceof ResourceError ? error : new ResourceError(reason);
  }
}

// Один владелец текущей подготовки; новый signal заменяет отменённую попытку того же URL.
export function createPendingLoads<T>(
  load: (path: string, signal: AbortSignal) => Promise<T>,
) {
  const pending = new Map<
    string,
    { signal: AbortSignal; controller: AbortController; promise: Promise<T> }
  >();
  let disposed = false;
  return {
    run(path: string, signal: AbortSignal): Promise<T> {
      if (disposed || signal.aborted)
        return Promise.reject(
          new DOMException('Операция отменена', 'AbortError'),
        );
      const previous = pending.get(path);
      if (previous?.signal === signal && !previous.controller.signal.aborted)
        return previous.promise;
      previous?.controller.abort();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const promise = abortable(
        load(path, controller.signal),
        controller.signal,
      ).finally(() => {
        signal.removeEventListener('abort', abort);
        if (pending.get(path)?.controller === controller) pending.delete(path);
      });
      pending.set(path, { signal, controller, promise });
      return promise;
    },
    dispose() {
      disposed = true;
      for (const { controller } of pending.values()) controller.abort();
      pending.clear();
    },
  };
}

export async function fetchResource(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
) {
  return resourceStep(
    async () => {
      const response = await fetcher(url, { signal });
      if (!response.ok) throw new ResourceError('load');
      return response;
    },
    signal,
    'load',
  );
}
