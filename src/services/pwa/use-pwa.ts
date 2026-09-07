import { useEffect, useState } from 'react';
import { createBrowserPwaService } from './browser.ts';
import type { PwaService, PwaState } from './service.ts';

export function usePwa(parentsOpen: boolean) {
  const [state, setState] = useState<PwaState>({
    offline: 'preparing',
    update: 'none',
    install: 'unavailable',
  });
  const [service, setService] = useState<PwaService | null>(null);
  useEffect(() => {
    const pwa = createBrowserPwaService();
    const detach = pwa.subscribe(() => setState(pwa.getSnapshot()));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      // Отдаём браузеру кадр оболочки и её ресурсы до начала precache.
      timer = setTimeout(() => {
        if (!cancelled) {
          setService(pwa);
          void pwa.start();
        }
      }, 0);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('load', start);
      detach();
      pwa.dispose();
    };
  }, []);
  useEffect(() => {
    if (parentsOpen) void service?.check();
  }, [parentsOpen, service]);
  return {
    state,
    retry: () => {
      void service?.retry();
    },
    install: () => {
      void service?.install();
    },
  };
}
