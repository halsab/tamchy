import { afterEach, expect, it, vi } from 'vitest';
import { installOfflineWorker, type WorkerScope } from './worker.ts';

function fixture() {
  const bytes = new TextEncoder().encode('recording');
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response);
    }),
  };
  let listener: (
    event: Parameters<Parameters<WorkerScope['addEventListener']>[1]>[0],
  ) => void;
  const scope = {
    registration: { scope: 'https://example.test/tamchy/' },
    caches: { has: vi.fn(async () => true), open: vi.fn(async () => cache) },
    crypto,
    fetch: vi.fn(async () => new Response(bytes)),
    addEventListener: vi.fn((_type, callback) => {
      listener = callback;
    }),
  } as unknown as WorkerScope;
  const fetchSpy = scope.fetch;
  const config = {
    release: 'release-a',
    cachePrefix: 'tamchy-scope',
    entries: [{ url: 'audio.mp3', revision: 'a', integrity: '' }],
  };
  async function setup() {
    config.entries[0]!.integrity =
      'sha256-' +
      btoa(
        String.fromCharCode(
          ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        ),
      );
    installOfflineWorker(scope, config);
  }
  async function request(type = 'VERIFY', release = config.release) {
    let task: Promise<unknown> | undefined;
    const reply = vi.fn();
    listener({
      data: { type, release },
      ports: [{ postMessage: reply }],
      source: { url: 'https://example.test/tamchy/' },
      waitUntil: (promise) => {
        task = promise;
      },
    });
    await task;
    return reply.mock.calls[0]?.[0];
  }
  return { setup, request, entries, cache, scope, config, fetchSpy };
}
afterEach(() => vi.useRealTimers());
it('не восполняет отсутствующий файл при проверке; повтор сохраняет и сверяет байты', async () => {
  const f = fixture();
  await f.setup();
  expect(await f.request()).toMatchObject({
    status: 'missing',
    release: 'release-a',
  });
  expect(f.fetchSpy).not.toHaveBeenCalled();
  expect(await f.request('REPAIR')).toMatchObject({ status: 'ready' });
  expect(f.cache.put).toHaveBeenCalledOnce();
  expect(await f.request()).toMatchObject({ status: 'ready' });
  f.entries.clear();
  expect(await f.request()).toMatchObject({ status: 'missing' });
});
it('отклоняет повреждённый ресурс, несовместимую версию и сетевые байты B при восстановлении A', async () => {
  const f = fixture();
  await f.setup();
  f.entries.set(
    'https://example.test/tamchy/audio.mp3?__WB_REVISION__=a',
    new Response('bad'),
  );
  expect(await f.request()).toMatchObject({ status: 'missing' });
  expect(await f.request('REPAIR', 'release-b')).toMatchObject({
    status: 'mismatch',
  });
  vi.mocked(f.fetchSpy).mockResolvedValue(new Response('version b'));
  expect(await f.request('REPAIR')).toMatchObject({ status: 'error' });
  expect(f.cache.put).not.toHaveBeenCalled();
});
it('недоступное хранилище не подтверждает офлайн', async () => {
  const f = fixture();
  await f.setup();
  vi.mocked(f.scope.caches.has).mockRejectedValue(
    new DOMException('Denied', 'SecurityError'),
  );
  expect(await f.request()).toMatchObject({ status: 'unsupported' });
});
it('зависшая проверка завершается по сроку без позднего ready', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.setup();
  vi.mocked(f.scope.caches.has).mockReturnValue(new Promise(() => {}));
  const pending = f.request();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await pending).toMatchObject({ status: 'error' });
});
