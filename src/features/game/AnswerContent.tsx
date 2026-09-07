import type { LearningItem } from '../../content/types.ts';
import styles from './GameScreen.module.css';

// Позиции в общей сетке 3×3; масштаб яблок не зависит от количества.
const positions: Record<number, readonly number[]> = {
  1: [5],
  2: [4, 6],
  3: [2, 7, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
};
export function AnswerContent({
  item,
  imageUrl,
  onImageError,
}: {
  item: LearningItem;
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
  return (
    <span className={styles.number} aria-hidden="true">
      <span className={styles.digit}>{item.value}</span>
      <span className={styles.apples}>
        {positions[item.value]!.map((position) => (
          <img
            key={position}
            src={imageUrl(item.countImage)}
            width="768"
            height="768"
            alt=""
            draggable="false"
            style={{
              gridRow: Math.ceil(position / 3),
              gridColumn: ((position - 1) % 3) + 1,
            }}
            onError={() => onImageError(item.countImage)}
          />
        ))}
      </span>
    </span>
  );
}
