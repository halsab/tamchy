import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from 'react';
import type { TintedPixels } from '../../services/assets/tint.ts';
import { drawTintedImage } from '../../services/assets/tinted-images.ts';
import { countLayout, visibleBounds } from './count-layout.ts';
import styles from './CountGroup.module.css';

const boundsCache = new WeakMap<
  TintedPixels,
  ReturnType<typeof visibleBounds>
>();
const rasterBounds = new Map<string, ReturnType<typeof visibleBounds>>();

export function CountGroup({
  value,
  maxValue,
  pixels,
  src,
  onError,
  removed = 0,
}: {
  value: number;
  maxValue: number;
  pixels?: TintedPixels | undefined;
  src?: string | undefined;
  onError: () => void;
  removed?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reportError = useEffectEvent(onError);
  const limit = Math.min(4, maxValue);
  const layout = countLayout(value, limit);
  useLayoutEffect(() => {
    const target = canvas.current!;
    const { columns, rows, cells } = countLayout(value, limit);
    const cell = 120;
    target.width = columns * cell;
    target.height = rows * cell;
    let active = true;
    function draw(
      source: CanvasImageSource,
      bounds: ReturnType<typeof visibleBounds>,
    ) {
      if (!active) return;
      const context = target.getContext('2d', { colorSpace: 'srgb' });
      if (!context) throw new Error('Нет canvas');
      // Прозрачные поля не уменьшают рисунок; масштаб одинаков для всей группы.
      const scale = (cell * 0.88) / Math.max(bounds.width, bounds.height);
      const width = bounds.width * scale,
        height = bounds.height * scale;
      for (const { x, y } of cells)
        context.drawImage(
          source,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          x * cell + (cell - width) / 2,
          y * cell + (cell - height) / 2,
          width,
          height,
        );
    }
    if (pixels) {
      const source = document.createElement('canvas');
      try {
        drawTintedImage(source, pixels);
        let bounds = boundsCache.get(pixels);
        if (!bounds) {
          bounds = visibleBounds(pixels);
          boundsCache.set(pixels, bounds);
        }
        draw(source, bounds);
      } catch {
        reportError();
      } finally {
        source.width = source.height = 0;
      }
    } else if (src) {
      const image = new Image();
      image.onload = () => {
        if (!active) return;
        const source = document.createElement('canvas');
        try {
          let bounds = rasterBounds.get(src);
          if (!bounds) {
            source.width = image.naturalWidth;
            source.height = image.naturalHeight;
            const context = source.getContext('2d', {
              willReadFrequently: true,
            });
            if (!context) throw new Error('Нет canvas');
            context.drawImage(image, 0, 0);
            bounds = visibleBounds(
              context.getImageData(0, 0, source.width, source.height),
            );
            if (rasterBounds.size >= 16) rasterBounds.clear();
            rasterBounds.set(src, bounds);
          }
          draw(image, bounds);
        } catch {
          reportError();
        } finally {
          source.width = source.height = 0;
        }
      };
      image.onerror = () => {
        if (active) reportError();
      };
      image.src = src;
    }
    return () => {
      active = false;
    };
  }, [value, limit, pixels, src]);
  return (
    <span className={styles.slot} data-quantity={value} aria-hidden="true">
      <span
        className={styles.group}
        style={
          {
            '--columns': layout.columns,
            '--rows': layout.rows,
            '--max-columns': limit,
            '--max-rows': Math.ceil(maxValue / limit),
          } as CSSProperties
        }
      >
        <canvas ref={canvas} className={styles.canvas} data-image={src} />
        {layout.cells.map(({ x, y }, index) =>
          index >= value - removed ? (
            <span
              key={index}
              className={styles.removed}
              data-removed="true"
              style={{
                left: `${(x / layout.columns) * 100}%`,
                top: `${(y / layout.rows) * 100}%`,
              }}
            />
          ) : null,
        )}
      </span>
    </span>
  );
}
