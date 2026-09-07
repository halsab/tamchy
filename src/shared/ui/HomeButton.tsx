import strings from '../../content/tt.json';
import { Icon } from './Icon.tsx';
import styles from './controls.module.css';
export function HomeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className={styles.iconButton}
      onClick={onClick}
      aria-label={strings.nav.home}
    >
      <Icon name="home" />
    </button>
  );
}
