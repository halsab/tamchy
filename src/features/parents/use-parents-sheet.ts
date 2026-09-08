import { useCallback, useLayoutEffect, useRef, type PointerEvent } from 'react';

export function useParentsSheet(
  open: boolean,
  onClosed: () => void,
  onHome: () => void,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const overflow = useRef<string | null>(null);
  const drag = useRef<{
    id: number;
    start: number;
    offset: number;
    lastY: number;
    lastTime: number;
    velocity: number;
  } | null>(null);
  const reducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const moveTo = useCallback((offset: number, finished?: () => void) => {
    const element = panel.current;
    if (!element) return;
    const from = getComputedStyle(element).transform;
    animation.current?.cancel();
    animation.current = null;
    const transform = `translateY(${offset}px)`;
    element.style.transform = transform;
    if (reducedMotion() || !element.animate) {
      finished?.();
      return;
    }
    const next = element.animate([{ transform: from }, { transform }], {
      duration: 240,
      easing: getComputedStyle(element).getPropertyValue('--ease-sheet').trim(),
    });
    animation.current = next;
    next.onfinish = () => {
      if (animation.current !== next) return;
      animation.current = null;
      finished?.();
    };
  }, []);

  const unlockScroll = useCallback(() => {
    if (overflow.current === null) return;
    document.body.style.overflow = overflow.current;
    overflow.current = null;
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current!;
    const content = panel.current!;
    drag.current = null;
    if (open) {
      if (!element.open) {
        overflow.current = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        element.showModal();
        content.style.transform = 'translateY(100%)';
      }
      moveTo(0);
    } else if (element.open) {
      moveTo(
        reducedMotion() ? 0 : content.getBoundingClientRect().height,
        () => {
          element.close();
          unlockScroll();
          onClosed();
        },
      );
    }
    return () => {
      if (!animation.current) return;
      // Отмена WAAPI снимает промежуточный кадр, поэтому сохраняем его до отмены.
      const transform = getComputedStyle(content).transform;
      animation.current.cancel();
      animation.current = null;
      content.style.transform = transform;
    };
  }, [open, moveTo, onClosed, unlockScroll]);

  useLayoutEffect(() => {
    const element = dialog.current!;
    return () => {
      animation.current?.cancel();
      element.close();
      unlockScroll();
    };
  }, [unlockScroll]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (
      !open ||
      !event.isPrimary ||
      event.button !== 0 ||
      drag.current ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
    const element = panel.current!;
    const offset = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      .m42;
    animation.current?.cancel();
    animation.current = null;
    element.style.transform = `translateY(${offset}px)`;
    drag.current = {
      id: event.pointerId,
      start: event.clientY,
      offset,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0)
      current.velocity = (event.clientY - current.lastY) / elapsed;
    current.lastY = event.clientY;
    current.lastTime = event.timeStamp;
    if (!reducedMotion()) {
      panel.current!.style.transform = `translateY(${Math.max(0, current.offset + event.clientY - current.start)}px)`;
    }
  }

  function finishDrag(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    const distance = event.clientY - current.start;
    const velocity =
      event.timeStamp - current.lastTime > 80 ? 0 : current.velocity;
    // Обратное движение и отмена жеста возвращают панель на место.
    if (
      !cancelled &&
      velocity >= 0 &&
      (distance >= 96 || (distance >= 24 && velocity > 0.5))
    )
      onHome();
    else moveTo(0);
  }

  return {
    dialog,
    panel,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finishDrag(event),
      onPointerCancel: (event: PointerEvent<HTMLElement>) =>
        finishDrag(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) =>
        finishDrag(event, true),
    },
  };
}
