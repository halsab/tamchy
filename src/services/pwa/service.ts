export type PwaState = {
  offline: 'preparing' | 'ready' | 'error' | 'unsupported';
  update: 'none' | 'preparing' | 'waiting' | 'error';
  install: 'unavailable' | 'available' | 'installed';
};
export type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type PwaEnvironment = {
  scope: string;
  release: string;
  supported: () => boolean;
  register: () => Promise<ServiceWorkerRegistration>;
  verify: (
    worker: ServiceWorker,
    type: 'VERIFY' | 'REPAIR',
    signal: AbortSignal,
  ) => Promise<{ status: string; release: string }>;
  subscribe: (
    check: () => void,
    prompt: (event: InstallPrompt) => void,
    installed: () => void,
  ) => () => void;
};

export function createPwaService(environment: PwaEnvironment) {
  let state: PwaState = {
    offline: 'preparing',
    update: 'none',
    install: 'unavailable',
  };
  let registration: ServiceWorkerRegistration | undefined;
  let prompt: InstallPrompt | undefined;
  let disposed = false;
  let started = false;
  let generation = 0;
  let operation: AbortController | undefined;
  let installing: ServiceWorker | null = null;
  const listeners = new Set<() => void>();
  const cleanup: (() => void)[] = [];
  function publish(patch: Partial<PwaState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  async function run(
    work: (signal: AbortSignal, current: () => boolean) => Promise<void>,
    keepOfflineOnFailure = false,
  ) {
    operation?.abort();
    const controller = new AbortController();
    operation = controller;
    const id = ++generation;
    const current = () =>
      !disposed && id === generation && !controller.signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work(controller.signal, current),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
          timer = setTimeout(() => reject(new Error('PWA timeout')), 120_000);
        }),
      ]);
    } catch (error) {
      if (current()) {
        const unsupported =
          error instanceof Error &&
          ['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(
            error.name,
          );
        publish(
          keepOfflineOnFailure && state.offline === 'ready'
            ? { update: 'error' }
            : { offline: unsupported ? 'unsupported' : 'error' },
        );
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async function verify(
    type: 'VERIFY' | 'REPAIR',
    signal: AbortSignal,
    current: () => boolean,
  ) {
    const active = registration?.active;
    if (active?.state === 'activated') {
      const result = await environment
        .verify(active, type, signal)
        .catch((error: unknown) => ({
          status:
            error instanceof Error &&
            ['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(
              error.name,
            )
              ? 'unsupported'
              : 'error',
          release: '',
        }));
      if (!current() || registration?.active !== active) return;
      publish({
        offline:
          result.status === 'ready' && result.release === environment.release
            ? 'ready'
            : result.status === 'unsupported'
              ? 'unsupported'
              : 'error',
      });
    } else if (
      !registration?.installing &&
      !registration?.waiting &&
      active?.state !== 'activating'
    ) {
      publish({ offline: 'error' });
    }
    const waiting = registration?.waiting;
    if (waiting) {
      const result = await environment.verify(waiting, 'VERIFY', signal);
      if (current() && registration?.waiting === waiting)
        publish({ update: result.status === 'ready' ? 'waiting' : 'error' });
    }
  }
  function watchWorker() {
    const worker =
      registration?.installing ??
      (registration?.active?.state === 'activating'
        ? registration.active
        : null);
    if (!worker || worker === installing) return;
    installing = worker;
    const isUpdate = Boolean(
      registration?.active && registration.active !== worker,
    );
    publish(isUpdate ? { update: 'preparing' } : { offline: 'preparing' });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (!disposed && installing === worker)
        publish(isUpdate ? { update: 'error' } : { offline: 'error' });
    }, 120_000);
    cleanup.push(() => clearTimeout(timer));
    const changed = () => {
      if (disposed || installing !== worker || expired) return;
      if (
        worker.state === 'redundant' ||
        worker.state === 'activated' ||
        (worker.state === 'installed' && isUpdate)
      )
        clearTimeout(timer);
      if (worker.state === 'redundant') {
        publish(isUpdate ? { update: 'error' } : { offline: 'error' });
      } else if (
        worker.state === 'activated' ||
        (worker.state === 'installed' && isUpdate)
      ) {
        void check();
      }
    };
    worker.addEventListener('statechange', changed);
    cleanup.push(() => worker.removeEventListener('statechange', changed));
    changed();
  }
  function check() {
    if (disposed || !registration) return Promise.resolve();
    watchWorker();
    return run((signal, current) => verify('VERIFY', signal, current));
  }
  async function connect(repair: boolean) {
    await run(async (signal, current) => {
      const next = await environment.register();
      if (!current()) return;
      if (next.scope !== environment.scope)
        throw new Error('Unexpected service worker scope');
      if (registration !== next) {
        registration = next;
        next.addEventListener('updatefound', watchWorker);
        cleanup.push(() =>
          next.removeEventListener('updatefound', watchWorker),
        );
      }
      watchWorker();
      await verify(repair ? 'REPAIR' : 'VERIFY', signal, current);
      // update() проверяет новую версию; активацией управляет только браузер.
      if (repair && current()) {
        try {
          await next.update();
        } catch {
          if (current()) publish({ update: 'error' });
        }
      }
    }, true);
  }
  async function start() {
    if (started || disposed) return;
    started = true;
    try {
      cleanup.push(
        environment.subscribe(
          () => {
            void check();
          },
          (event) => {
            event.preventDefault();
            prompt = event;
            publish({ install: 'available' });
          },
          () => {
            prompt = undefined;
            publish({ install: 'installed' });
          },
        ),
      );
      if (!environment.supported()) {
        publish({ offline: 'unsupported' });
        return;
      }
    } catch {
      publish({ offline: 'unsupported' });
      return;
    }
    await connect(false);
  }
  async function retry() {
    if (disposed) return;
    publish(
      state.offline === 'ready'
        ? { update: 'preparing' }
        : { offline: 'preparing' },
    );
    await connect(true);
  }
  async function install() {
    const event = prompt;
    if (!event || disposed) return;
    prompt = undefined;
    publish({ install: 'unavailable' });
    try {
      // prompt вызывается до первого await, непосредственно из нажатия.
      await event.prompt();
      await event.userChoice;
    } catch {
      /* Системная установка остаётся доступной через меню браузера. */
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    check,
    retry,
    install,
    dispose: () => {
      disposed = true;
      generation++;
      operation?.abort();
      prompt = undefined;
      for (const detach of cleanup) detach();
      listeners.clear();
    },
  };
}
export type PwaService = ReturnType<typeof createPwaService>;
