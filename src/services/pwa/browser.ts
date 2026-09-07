import {
  createPwaService,
  type InstallPrompt,
  type PwaEnvironment,
} from './service.ts';

export function browserPwaEnvironment(): PwaEnvironment {
  const scope = new URL(import.meta.env.BASE_URL, location.origin).href;
  return {
    scope,
    release: import.meta.env.VITE_APP_RELEASE,
    supported: () =>
      import.meta.env.PROD &&
      import.meta.env.MODE !== 'check' &&
      'serviceWorker' in navigator &&
      'caches' in window &&
      window.isSecureContext,
    register: () =>
      navigator.serviceWorker.register(new URL('sw.js', scope), {
        scope,
        updateViaCache: 'none',
      }),
    verify: (worker, type, signal) =>
      new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const finish = (result: { status: string; release: string }) => {
          cleanup();
          resolve(result);
        };
        const abort = () => {
          cleanup();
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(
          () => finish({ status: 'error', release: '' }),
          type === 'REPAIR' ? 121_000 : 16_000,
        );
        function cleanup() {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          channel.port1.close();
          channel.port2.close();
        }
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (
            typeof data === 'object' &&
            data !== null &&
            'status' in data &&
            typeof data.status === 'string' &&
            'release' in data &&
            typeof data.release === 'string'
          )
            finish({ status: data.status, release: data.release });
        };
        try {
          worker.postMessage(
            {
              type,
              ...(type === 'REPAIR'
                ? { release: import.meta.env.VITE_APP_RELEASE }
                : {}),
            },
            [channel.port2],
          );
        } catch {
          finish({ status: 'error', release: '' });
        }
      }),
    subscribe(check, prompt, installed) {
      let subscribed = true;
      // ready покрывает активацию, завершившуюся между register и подпиской statechange.
      void navigator.serviceWorker?.ready
        .then(() => {
          if (subscribed) check();
        })
        .catch(() => {});
      const visible = () => {
        if (document.visibilityState === 'visible') check();
      };
      const available = (event: Event) => {
        if (
          'prompt' in event &&
          typeof event.prompt === 'function' &&
          'userChoice' in event
        )
          prompt(event as InstallPrompt);
      };
      window.addEventListener('beforeinstallprompt', available);
      window.addEventListener('appinstalled', installed);
      window.addEventListener('pageshow', check);
      document.addEventListener('visibilitychange', visible);
      navigator.serviceWorker?.addEventListener('controllerchange', check);
      if (window.matchMedia?.('(display-mode: standalone)').matches)
        installed();
      return () => {
        subscribed = false;
        window.removeEventListener('beforeinstallprompt', available);
        window.removeEventListener('appinstalled', installed);
        window.removeEventListener('pageshow', check);
        document.removeEventListener('visibilitychange', visible);
        navigator.serviceWorker?.removeEventListener('controllerchange', check);
      };
    },
  };
}
export const createBrowserPwaService = () =>
  createPwaService(browserPwaEnvironment());
