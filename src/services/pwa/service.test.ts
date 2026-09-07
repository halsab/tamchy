import { afterEach, expect, it, vi } from 'vitest';
import { createPwaService, type PwaEnvironment } from './service.ts';

class Worker extends EventTarget {
  state = 'activated';
  scriptURL = 'https://example.test/tamchy/sw.js';
}
function fixture() {
  const worker = new Worker();
  const registration = Object.assign(new EventTarget(), {
    scope: 'https://example.test/tamchy/',
    active: worker,
    waiting: null as Worker | null,
    installing: null as Worker | null,
    update: vi.fn(async () => {}),
  });
  const environment = {
    supported: () => true,
    register: vi.fn(async () => registration),
    verify: vi.fn(async () => ({ status: 'ready', release: 'a' })),
    subscribe: vi.fn(() => () => {}),
    scope: registration.scope,
    release: 'a',
  } as unknown as PwaEnvironment;
  const service = createPwaService(environment);
  return { service, environment, registration, worker };
}
afterEach(() => vi.useRealTimers());
it('готовность требует проверки активной версии, потеря ресурсов снимает ready, повтор явный', async () => {
  const f = fixture();
  expect(f.service.getSnapshot().offline).toBe('preparing');
  await f.service.start();
  expect(f.service.getSnapshot().offline).toBe('ready');
  vi.mocked(f.environment.verify).mockResolvedValue({
    status: 'missing',
    release: 'a',
  });
  await f.service.check();
  expect(f.service.getSnapshot().offline).toBe('error');
  vi.mocked(f.environment.verify).mockResolvedValue({
    status: 'ready',
    release: 'a',
  });
  await f.service.retry();
  expect(f.environment.verify).toHaveBeenCalledWith(
    f.worker,
    'REPAIR',
    expect.any(AbortSignal),
  );
  expect(f.service.getSnapshot().offline).toBe('ready');
  f.service.dispose();
});
it('сбой B и waiting не меняют готовность A; неверная версия не даёт ready', async () => {
  const f = fixture();
  await f.service.start();
  const update = new Worker();
  update.state = 'installing';
  f.registration.installing = update;
  f.registration.dispatchEvent(new Event('updatefound'));
  expect(f.service.getSnapshot()).toMatchObject({
    offline: 'ready',
    update: 'preparing',
  });
  update.state = 'redundant';
  update.dispatchEvent(new Event('statechange'));
  expect(f.service.getSnapshot()).toMatchObject({
    offline: 'ready',
    update: 'error',
  });
  f.registration.waiting = new Worker();
  await f.service.check();
  expect(f.service.getSnapshot()).toMatchObject({
    offline: 'ready',
    update: 'waiting',
  });
  vi.mocked(f.environment.verify).mockResolvedValue({
    status: 'ready',
    release: 'b',
  });
  await f.service.check();
  expect(f.service.getSnapshot().offline).toBe('error');
  f.service.dispose();
});
it('недоступные API и запрет регистрации сохраняют честное unsupported', async () => {
  const f = fixture();
  f.environment.supported = () => false;
  await f.service.start();
  expect(f.service.getSnapshot().offline).toBe('unsupported');
  expect(f.environment.register).not.toHaveBeenCalled();
  const g = fixture();
  vi.mocked(g.environment.register).mockRejectedValue(
    new DOMException('denied', 'SecurityError'),
  );
  await g.service.start();
  expect(g.service.getSnapshot().offline).toBe('unsupported');
});
it('поздний результат проверки и событие старого worker игнорируются после retry/dispose', async () => {
  const f = fixture();
  await f.service.start();
  let finish!: (result: { status: string; release: string }) => void;
  vi.mocked(f.environment.verify).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = f.service.check();
  await f.service.retry();
  finish({ status: 'missing', release: 'a' });
  await old;
  expect(f.service.getSnapshot().offline).toBe('ready');
  f.service.dispose();
  f.registration.installing = new Worker();
  f.registration.dispatchEvent(new Event('updatefound'));
  expect(f.service.getSnapshot().offline).toBe('ready');
});
it('зависшая регистрация заканчивается ошибкой; поздний успех не принимается', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: (value: ServiceWorkerRegistration) => void;
  vi.mocked(f.environment.register).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.service.start();
  await vi.advanceTimersByTimeAsync(120_000);
  await pending;
  expect(f.service.getSnapshot().offline).toBe('error');
  finish(f.registration as unknown as ServiceWorkerRegistration);
  await Promise.resolve();
  expect(f.service.getSnapshot().offline).toBe('error');
  f.service.dispose();
});
it('зависшая установка завершается ошибкой, поздние события той попытки не дают ready', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const worker = new Worker();
  worker.state = 'installing';
  Object.assign(f.registration, { active: null, installing: worker });
  await f.service.start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.service.getSnapshot().offline).toBe('error');
  Object.assign(f.registration, { active: worker, installing: null });
  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await Promise.resolve();
  expect(f.service.getSnapshot().offline).toBe('error');
  f.service.dispose();
});
it('исключение при доступе к API не ломает start', async () => {
  const f = fixture();
  vi.mocked(f.environment.subscribe).mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  await f.service.start();
  expect(f.service.getSnapshot().offline).toBe('unsupported');
});
it('приглашение вызывается из нажатия; accepted не подменяет событие установки', async () => {
  const f = fixture();
  let available!: Parameters<PwaEnvironment['subscribe']>[1];
  let installed!: Parameters<PwaEnvironment['subscribe']>[2];
  vi.mocked(f.environment.subscribe).mockImplementation(
    (_check, prompt, done) => {
      available = prompt;
      installed = done;
      return () => {};
    },
  );
  await f.service.start();
  const prompt = vi.fn(async () => {});
  available(
    Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    }),
  );
  expect(prompt).not.toHaveBeenCalled();
  expect(f.service.getSnapshot().install).toBe('available');
  const pending = f.service.install();
  expect(prompt).toHaveBeenCalledOnce();
  await pending;
  expect(f.service.getSnapshot().install).toBe('unavailable');
  installed();
  expect(f.service.getSnapshot().install).toBe('installed');
  f.service.dispose();
});
it('подписывается на уже активирующийся worker после перезагрузки страницы', async () => {
  const f = fixture();
  f.worker.state = 'activating';
  await f.service.start();
  expect(f.service.getSnapshot().offline).toBe('preparing');
  f.worker.state = 'activated';
  f.worker.dispatchEvent(new Event('statechange'));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.service.getSnapshot().offline).toBe('ready');
  f.service.dispose();
});
it('ready запускает наблюдение активации, пропущенной между register и updatefound', async () => {
  const f = fixture();
  Object.assign(f.registration, { active: null });
  await f.service.start();
  f.worker.state = 'activating';
  Object.assign(f.registration, { active: f.worker });
  await f.service.check();
  f.worker.state = 'activated';
  f.worker.dispatchEvent(new Event('statechange'));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.service.getSnapshot().offline).toBe('ready');
  f.service.dispose();
});
it('потеря доступа к проверке после ready снимает готовность', async () => {
  const f = fixture();
  await f.service.start();
  vi.mocked(f.environment.verify).mockRejectedValue(
    new DOMException('denied', 'SecurityError'),
  );
  await f.service.check();
  expect(f.service.getSnapshot().offline).toBe('unsupported');
  f.service.dispose();
});
