import type { PwaState } from '../../services/pwa/service.ts';
import controls from '../../shared/ui/controls.module.css';
import strings from '../../content/tt.json';
import { HomeButton } from '../../shared/ui/HomeButton.tsx';
import styles from './ParentsScreen.module.css';

export function ParentsScreen({
  onHome,
  version,
  pwa,
  onRetry,
  onInstall,
}: {
  onHome: () => void;
  version: string;
  pwa: PwaState;
  onRetry: () => void;
  onInstall: () => void;
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
          <p role="status" aria-label={strings.parents.connectionTitle}>
            {pwa.offline === 'ready'
              ? strings.status.offlineReady
              : strings.pwa[pwa.offline]}
          </p>
          {pwa.offline === 'error' ? (
            <button className={controls.action} onClick={onRetry}>
              {strings.action.retry}
            </button>
          ) : null}
          <p>{strings.pwa.cleared}</p>
        </section>
        <section>
          <h2>{strings.pwa.installTitle}</h2>
          <p>{strings.pwa.ios}</p>
          <p>{strings.pwa.android}</p>
          {pwa.install === 'available' ? (
            <button className={controls.action} onClick={onInstall}>
              {strings.pwa.installAction}
            </button>
          ) : pwa.install === 'installed' ? (
            <p>{strings.pwa.installed}</p>
          ) : null}
        </section>
        <section>
          <h2>{strings.pwa.updateTitle}</h2>
          <p role="status" aria-label={strings.pwa.updateTitle}>
            {
              {
                none: strings.pwa.updateNone,
                preparing: strings.pwa.updatePreparing,
                waiting: strings.pwa.updateWaiting,
                error: strings.pwa.updateError,
              }[pwa.update]
            }
          </p>
          {pwa.update === 'error' && pwa.offline !== 'error' ? (
            <button className={controls.action} onClick={onRetry}>
              {strings.action.retry}
            </button>
          ) : null}
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
