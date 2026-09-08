import type { Category } from '../../content/types.ts';
import strings from '../../content/tt.json';
import { assetUrl } from '../../services/assets/asset-url.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './HomeScreen.module.css';
import type { Ref } from 'react';

export function HomeScreen({
  categories,
  onStart,
  onParents,
  parentsButton,
}: {
  categories: Category[];
  onStart: (category: Category) => void;
  onParents: () => void;
  parentsButton?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className={styles.home}>
      <h1 className={styles.title}>{strings.app.name}</h1>
      <div className={styles.categories}>
        {categories.map((category) => (
          <button
            key={category.id}
            className={`${styles.category} ${styles[category.id]}`}
            onClick={() => onStart(category)}
          >
            <img
              src={assetUrl(category.image)}
              alt=""
              width="768"
              height="768"
              draggable="false"
            />
            <span>{category.labelTt}</span>
          </button>
        ))}
      </div>
      <button
        ref={parentsButton}
        className={styles.parents}
        onClick={onParents}
        aria-label={strings.nav.parents}
        aria-haspopup="dialog"
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
