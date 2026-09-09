import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { CountIllustration } from '../../domain/game/exercise.ts';
import type { TintedPixels } from '../../services/assets/tint.ts';
import { drawTintedImage } from '../../services/assets/tinted-images.ts';
import styles from './SeniorContent.module.css';
import contrast from './ColorContrast.module.css';
import { CountGroup } from './CountGroup.tsx';

export type SeniorVisualAssets = {
  imageUrl: (path: string) => string;
  tintedPixels: (path: string, hex: string) => TintedPixels | undefined;
  onImageError: (path: string, hex?: string) => void;
};

function TintedCanvas({
  pixels,
  isWhite,
  onError,
}: {
  pixels: TintedPixels | undefined;
  isWhite: boolean;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reportError = useEffectEvent(onError);
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    // Сброс также очищает старое изображение, пока новый обязательный ресурс ещё готовится.
    target.width = target.height = 128;
    if (!pixels) return;
    try {
      drawTintedImage(target, pixels);
    } catch {
      reportError();
    }
  }, [pixels]);
  return (
    <canvas
      ref={canvas}
      className={`${styles.image} ${isWhite ? contrast.whiteImage : ''}`}
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
      isWhite={object.hex === '#FFFFFF'}
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
  maxValue,
  object,
  assets,
  removed = 0,
}: {
  value: number;
  maxValue: number;
  object: CountIllustration;
  assets: SeniorVisualAssets;
  removed?: number;
}) {
  return (
    <CountGroup
      value={value}
      maxValue={maxValue}
      removed={removed}
      isWhite={object.kind === 'tinted' && object.hex === '#FFFFFF'}
      pixels={
        object.kind === 'tinted'
          ? assets.tintedPixels(object.image, object.hex)
          : undefined
      }
      src={object.kind === 'raster' ? assets.imageUrl(object.image) : undefined}
      onError={() =>
        assets.onImageError(
          object.image,
          object.kind === 'tinted' ? object.hex : undefined,
        )
      }
    />
  );
}
