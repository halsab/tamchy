import type { ContentV2 } from '../../content/types.ts';
import type { SeniorExercise } from '../../domain/game/exercise.ts';
import { AnswerContent } from './AnswerContent.tsx';
import { SeniorCountGroup, SeniorIllustration } from './SeniorIllustration.tsx';
import type { SeniorVisualAssets } from './SeniorIllustration.tsx';
import styles from './SeniorContent.module.css';

type Props = {
  exercise: SeniorExercise;
  content: ContentV2;
  assets: SeniorVisualAssets;
};

export function SeniorPrompt({ exercise, content, assets }: Props) {
  const prompt = exercise.prompt;
  let visual;
  switch (prompt.kind) {
    case 'tinted-object':
      visual = (
        <span className={styles.sample}>
          <SeniorIllustration object={prompt.object} assets={assets} />
        </span>
      );
      break;
    case 'silhouette': {
      const url = `url(${JSON.stringify(assets.imageUrl(prompt.image))})`;
      visual = (
        <span className={styles.sample}>
          <span
            className={styles.silhouette}
            data-silhouette
            style={{ maskImage: url, WebkitMaskImage: url }}
          />
          <img
            className={styles.maskProbe}
            src={assets.imageUrl(prompt.image)}
            alt=""
            onError={() => assets.onImageError(prompt.image)}
          />
        </span>
      );
      break;
    }
    case 'color-sequence':
      visual = (
        <span className={styles.sequence}>
          {prompt.colorIds.map((id, index) => (
            <span
              key={index}
              className={styles.sequenceChip}
              data-color={id}
              style={{
                backgroundColor: content.colors.find((x) => x.id === id)!.hex,
              }}
            />
          ))}
          <span className={styles.next} data-next>
            ?
          </span>
        </span>
      );
      break;
    case 'quantity':
      visual = (
        <SeniorCountGroup
          value={prompt.value}
          object={prompt.countObject}
          assets={assets}
        />
      );
      break;
    case 'numeral':
      visual = <span className={styles.digit}>{prompt.value}</span>;
      break;
    case 'addition':
      visual = (
        <span className={styles.addition}>
          <SeniorCountGroup
            value={prompt.left}
            object={prompt.countObject}
            assets={assets}
          />
          <SeniorCountGroup
            value={prompt.right}
            object={prompt.countObject}
            assets={assets}
          />
        </span>
      );
      break;
    case 'subtraction':
      visual = (
        <SeniorCountGroup
          value={prompt.total}
          removed={prompt.removed}
          object={prompt.countObject}
          assets={assets}
        />
      );
      break;
    default:
      visual = null;
  }
  return (
    <div className={styles.prompt}>
      {visual ? (
        <div className={styles.visual} aria-hidden="true">
          {visual}
        </div>
      ) : null}
      <p>{prompt.textTt}</p>
    </div>
  );
}

export function SeniorAnswerContent({
  exercise,
  option,
  content,
  assets,
}: Props & { option: SeniorExercise['options'][number] }) {
  switch (option.kind) {
    case 'color':
    case 'animal':
      return (
        <AnswerContent
          item={option}
          imageUrl={assets.imageUrl}
          onImageError={assets.onImageError}
        />
      );
    case 'number':
      return (
        <span className={styles.digit} aria-hidden="true">
          {option.value}
        </span>
      );
    case 'group':
      if (exercise.kind !== 'N1-C' && exercise.kind !== 'N2')
        throw new Error('Группа не соответствует упражнению.');
      return (
        <SeniorCountGroup
          value={option.value}
          object={exercise.countObject}
          assets={assets}
        />
      );
    case 'shape':
    case 'sized-shape': {
      const shape = content.shapes.find((x) => x.id === option.shapeId)!;
      const object = content.countObjects.find(
        (x) => x.id === shape.countObjectId,
      )!;
      const color = content.colors.find((x) => x.id === option.colorId)!;
      return (
        <span
          className={styles.shape}
          data-size={option.kind === 'sized-shape' ? option.sizeId : 'big'}
          aria-hidden="true"
        >
          <SeniorIllustration
            object={{
              kind: 'tinted',
              id: object.id,
              image: object.image,
              hex: color.hex,
            }}
            assets={assets}
          />
        </span>
      );
    }
  }
}
