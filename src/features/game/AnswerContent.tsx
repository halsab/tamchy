import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type {
  CountIllustration,
  JuniorExercise,
} from '../../domain/game/exercise.ts';
import { drawTintedImage } from '../../services/assets/tinted-images.ts';
import type { TintedPixels } from '../../services/assets/tint.ts';
import styles from './GameScreen.module.css';

function TintedCountGroup({
  count,
  pixels,
  onError,
}: {
  count: number;
  pixels?: TintedPixels | undefined;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reportError = useEffectEvent(onError);
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target || !pixels) return;
    try {
      const source = document.createElement('canvas');
      drawTintedImage(source, pixels);
      const context = target.getContext('2d', { colorSpace: 'srgb' });
      if (!context) throw new Error('Нет canvas');
      context.clearRect(0, 0, target.width, target.height);
      // Один небольшой canvas на группу, без отдельного RGBA-буфера 1024×1024 для каждого предмета.
      for (let index = 0; index < count; index++)
        context.drawImage(
          source,
          (index % 4) * 112,
          Math.floor(index / 4) * 112,
          112,
          112,
        );
      source.width = source.height = 0;
    } catch {
      reportError();
    }
  }, [count, pixels]);
  return (
    <canvas
      ref={canvas}
      className={styles.tintedCount}
      width="448"
      height="336"
    />
  );
}

export function AnswerContent({
  item,
  countObject,
  pixels,
  imageUrl,
  onImageError,
}: {
  item: JuniorExercise['options'][number];
  countObject?: CountIllustration | undefined;
  pixels?: TintedPixels | undefined;
  imageUrl: (path: string) => string;
  onImageError: (path: string) => void;
}) {
  if (item.kind === 'color')
    return (
      <span
        className={styles.chip}
        style={{ backgroundColor: item.hex }}
        aria-hidden="true"
      />
    );
  if (item.kind === 'animal')
    return (
      <img
        className={styles.animal}
        src={imageUrl(item.image)}
        width="768"
        height="768"
        alt=""
        draggable="false"
        onError={() => onImageError(item.image)}
      />
    );
  if (!countObject)
    throw new Error('Числовому упражнению нужен счётный объект.');
  return (
    <span className={styles.number} aria-hidden="true">
      <span className={styles.digit}>{item.value}</span>
      <span className={styles.counts}>
        {countObject.kind === 'tinted' ? (
          <TintedCountGroup
            count={item.value}
            pixels={pixels}
            onError={() => onImageError(countObject.image)}
          />
        ) : (
          Array.from({ length: item.value }, (_, index) => (
            <img
              key={index}
              src={imageUrl(countObject.image)}
              width="768"
              height="768"
              alt=""
              draggable="false"
              onError={() => onImageError(countObject.image)}
            />
          ))
        )}
      </span>
    </span>
  );
}
