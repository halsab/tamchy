import type {
  CountIllustration,
  JuniorExercise,
} from '../../domain/game/exercise.ts';
import { CountGroup } from './CountGroup.tsx';
import type { TintedPixels } from '../../services/assets/tint.ts';
import styles from './GameScreen.module.css';
import contrast from './ColorContrast.module.css';

export function AnswerContent({
  item,
  countObject,
  maxCount = 10,
  pixels,
  imageUrl,
  onImageError,
}: {
  item: JuniorExercise['options'][number];
  countObject?: CountIllustration | undefined;
  maxCount?: number;
  pixels?: TintedPixels | undefined;
  imageUrl: (path: string) => string;
  onImageError: (path: string) => void;
}) {
  if (item.kind === 'color')
    return (
      <span
        className={`${styles.chip} ${item.hex === '#FFFFFF' ? contrast.whiteChip : ''}`}
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
      <CountGroup
        value={item.value}
        maxValue={maxCount}
        isWhite={countObject.kind === 'tinted' && countObject.hex === '#FFFFFF'}
        pixels={pixels}
        src={
          countObject.kind === 'raster'
            ? imageUrl(countObject.image)
            : undefined
        }
        onError={() => onImageError(countObject.image)}
      />
    </span>
  );
}
