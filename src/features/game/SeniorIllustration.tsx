import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { CountIllustration } from '../../domain/game/exercise.ts';
import type { TintedPixels } from '../../services/assets/tint.ts';
import { drawTintedImage } from '../../services/assets/tinted-images.ts';
import styles from './SeniorContent.module.css';

export type SeniorVisualAssets = {
  imageUrl: (path: string) => string;
  tintedPixels: (path: string, hex: string) => TintedPixels | undefined;
  onImageError: (path: string, hex?: string) => void;
};

function TintedCanvas({
  pixels,
  count,
  onError,
}: {
  pixels: TintedPixels | undefined;
  count?: number;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reportError = useEffectEvent(onError);
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    // Сброс также очищает старое изображение, пока новый обязательный ресурс ещё готовится.
    target.width = count === undefined ? 128 : 360;
    target.height = count === undefined ? 128 : 480;
    if (!pixels) return;
    try {
      if (count === undefined) {
        drawTintedImage(target, pixels);
        return;
      }
      const source = document.createElement('canvas');
      try {
        drawTintedImage(source, pixels);
        const context = target.getContext('2d', { colorSpace: 'srgb' });
        if (!context) throw new Error('Нет canvas');
        // Одна группа — один небольшой canvas; размер ячейки не зависит от количества.
        for (let index = 0; index < count; index++)
          context.drawImage(
            source,
            (index % 3) * 120,
            Math.floor(index / 3) * 120,
            120,
            120,
          );
      } finally {
        source.width = source.height = 0;
      }
    } catch {
      reportError();
    }
  }, [pixels, count]);
  return (
    <canvas
      ref={canvas}
      className={count === undefined ? styles.image : styles.countCanvas}
      aria-hidden="true"
    />
  );
}

export function SeniorIllustration({
  object,
  assets,
}: {
  object: CountIllustration;
  assets: SeniorVisualAssets;
}) {
  return object.kind === 'tinted' ? (
    <TintedCanvas
      pixels={assets.tintedPixels(object.image, object.hex)}
      onError={() => assets.onImageError(object.image, object.hex)}
    />
  ) : (
    <img
      className={styles.image}
      src={assets.imageUrl(object.image)}
      alt=""
      draggable="false"
      width="768"
      height="768"
      onError={() => assets.onImageError(object.image)}
    />
  );
}

export function SeniorCountGroup({
  value,
  object,
  assets,
  removed = 0,
}: {
  value: number;
  object: CountIllustration;
  assets: SeniorVisualAssets;
  removed?: number;
}) {
  return (
    <span
      className={styles.countGroup}
      data-quantity={value}
      aria-hidden="true"
    >
      {object.kind === 'tinted' ? (
        <TintedCanvas
          pixels={assets.tintedPixels(object.image, object.hex)}
          count={value}
          onError={() => assets.onImageError(object.image, object.hex)}
        />
      ) : null}
      {Array.from({ length: value }, (_, index) => (
        <span
          key={index}
          className={styles.countCell}
          data-removed={index >= value - removed}
        >
          {object.kind === 'raster' ? (
            <SeniorIllustration object={object} assets={assets} />
          ) : null}
        </span>
      ))}
    </span>
  );
}
