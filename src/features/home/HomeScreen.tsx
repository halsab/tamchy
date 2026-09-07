import type { Category } from '../../content/types.ts';
import strings from '../../content/tt.json';
import { assetUrl } from '../../services/assets/asset-url.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './HomeScreen.module.css';

export function HomeScreen({
  categories,
  onStart,
  onParents,
}: {
  categories: Category[];
  onStart: (category: Category) => void;
  onParents: () => void;
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
      <button className={styles.parents} onClick={onParents}>
        <Icon name="info" />
        {strings.nav.parents}
      </button>
    </div>
  );
}
