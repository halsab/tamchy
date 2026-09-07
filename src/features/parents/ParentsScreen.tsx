import strings from '../../content/tt.json';
import { HomeButton } from '../../shared/ui/HomeButton.tsx';
import styles from './ParentsScreen.module.css';

export function ParentsScreen({
  onHome,
  version,
}: {
  onHome: () => void;
  version: string;
}) {
  return (
    <div className={styles.parents}>
      <header className={styles.header}>
        <HomeButton onClick={onHome} />
        <h1>{strings.nav.parents}</h1>
      </header>
      <div className={styles.content}>
        <p className={styles.intro}>{strings.parents.about}</p>
        <section>
          <h2>{strings.parents.connectionTitle}</h2>
          <p>{strings.parents.connection}</p>
        </section>
        <section>
          <h2>{strings.parents.dataTitle}</h2>
          <p>{strings.parents.data}</p>
          <p>{strings.parents.hosting}</p>
        </section>
        <section>
          <h2>{strings.parents.materialsTitle}</h2>
          <p>{strings.parents.materials}</p>
        </section>
        <p className={styles.version}>
          {strings.parents.version} {version}
        </p>
      </div>
    </div>
  );
}
