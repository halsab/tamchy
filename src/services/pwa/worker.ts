export type OfflineManifest = {
  release: string;
  cachePrefix: string;
  entries: { url: string; revision: string | null; integrity: string }[];
};
export type WorkerScope = {
  registration: { scope: string };
  caches: CacheStorage;
  crypto: Crypto;
  fetch: typeof fetch;
  addEventListener: (
    type: 'message',
    listener: (event: {
      data: { type?: string; release?: string } | null;
      source: { url?: string } | null;
      ports: { postMessage: (data: unknown) => void }[];
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void,
  ) => void;
};

export function installOfflineWorker(
  scope: WorkerScope,
  manifest: OfflineManifest,
) {
  const timeoutMs = 15_000;
  const nativeFetch = scope.fetch.bind(scope);
  // Workbox готовит файлы последовательно; фоновым запросам задаётся низкий приоритет.
  scope.fetch = async (input, init) => {
    const request = new Request(input, init);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (request.signal.aborted) abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await nativeFetch(request, {
        signal: controller.signal,
        priority: 'low',
      });
      if (!response.ok) return response;
      await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  };
  const cacheName = `${manifest.cachePrefix}-precache-v2-${scope.registration.scope}`;
  async function matches(response: Response | undefined, integrity: string) {
    if (!response?.ok) return false;
    const bytes = await response.arrayBuffer();
    const digest = await scope.crypto.subtle.digest('SHA-256', bytes);
    return (
      `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}` ===
      integrity
    );
  }
  async function inspect(
    repair: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    const present = await scope.caches.has(cacheName);
    if (!present && !repair) return 'missing';
    const cache = await scope.caches.open(cacheName);
    for (const entry of manifest.entries) {
      signal.throwIfAborted();
      const url = new URL(entry.url, scope.registration.scope);
      const key = new URL(url);
      if (entry.revision)
        key.searchParams.set('__WB_REVISION__', entry.revision);
      if (await matches(await cache.match(key.href), entry.integrity)) continue;
      if (!repair) return 'missing';
      const response = await scope.fetch(url.href, {
        cache: 'no-store',
        integrity: entry.integrity,
        signal,
      });
      if (!(await matches(response.clone(), entry.integrity))) return 'error';
      // После отмены или истечения срока поздние байты не записываются.
      signal.throwIfAborted();
      await cache.put(key.href, response);
    }
    signal.throwIfAborted();
    return 'ready';
  }
  scope.addEventListener('message', (event) => {
    const { data, source } = event;
    if (
      !data ||
      !['VERIFY', 'REPAIR'].includes(data.type ?? '') ||
      !source?.url ||
      !event.ports[0]
    )
      return;
    const client = new URL(source.url);
    const root = new URL(scope.registration.scope);
    if (
      client.origin !== root.origin ||
      !client.pathname.startsWith(root.pathname)
    )
      return;
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        let status: string;
        try {
          status =
            data.release && data.release !== manifest.release
              ? 'mismatch'
              : await Promise.race([
                  inspect(data.type === 'REPAIR', controller.signal),
                  new Promise<string>((resolve) => {
                    timer = setTimeout(
                      () => {
                        controller.abort();
                        resolve('error');
                      },
                      data.type === 'REPAIR' ? 120_000 : timeoutMs,
                    );
                  }),
                ]);
        } catch (error) {
          status =
            error instanceof Error &&
            ['SecurityError', 'NotAllowedError'].includes(error.name)
              ? 'unsupported'
              : 'error';
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
        port.postMessage({ status, release: manifest.release });
      })(),
    );
  });
}
