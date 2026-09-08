import { useLayoutEffect } from 'react';

const blockedEvents = [
  'contextmenu',
  'selectstart',
  'dragstart',
  'gesturestart',
  'gesturechange',
] as const;

export function useAppGestures() {
  useLayoutEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    // Safari использует gesture*, а пинч на трекпаде может приходить как Ctrl + wheel.
    const preventWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    for (const type of blockedEvents)
      document.addEventListener(type, prevent, { passive: false });
    document.addEventListener('wheel', preventWheelZoom, { passive: false });

    return () => {
      for (const type of blockedEvents)
        document.removeEventListener(type, prevent);
      document.removeEventListener('wheel', preventWheelZoom);
    };
  }, []);
}
