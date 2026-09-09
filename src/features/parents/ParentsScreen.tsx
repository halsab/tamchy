import type { PwaState } from '../../services/pwa/service.ts';
import controls from '../../shared/ui/controls.module.css';
import strings from '../../content/tt.json';
import styles from './ParentsScreen.module.css';
import { useRef } from 'react';
import type { AgeMode } from '../../services/preferences/age-mode.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { useParentsSheet } from './use-parents-sheet.ts';

export function ParentsScreen({
  open,
  onHome,
  onClosed,
  mode,
  onModeChange,
  version,
  pwa,
  onRetry,
  onInstall,
}: {
  open: boolean;
  onHome: () => void;
  onClosed: () => void;
  mode: AgeMode;
  onModeChange: (mode: AgeMode) => void;
  version: string;
  pwa: PwaState;
  onRetry: () => void;
  onInstall: () => void;
}) {
  const { dialog, panel, content, handle } = useParentsSheet(
    open,
    onClosed,
    onHome,
  );
  const backdropPress = useRef(false);
  return (
    <dialog
      ref={dialog}
      className={styles.overlay}
      aria-labelledby="parents-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:checked, [tabindex="0"]',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onHome();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          onHome();
        backdropPress.current = false;
      }}
    >
      <div ref={panel} className={styles.parents}>
        <header className={styles.header}>
          <div className={styles.dragHandle} {...handle} aria-hidden="true">
            <span className={styles.handle} />
          </div>
          <div className={styles.heading}>
            <h1 id="parents-title">{strings.nav.parents}</h1>
            <button
              className={controls.iconButton}
              onClick={onHome}
              aria-label={strings.action.close}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div ref={content} className={styles.content}>
          <section>
            <h2>{strings.parents.settingsTitle}</h2>
            <fieldset
              className={styles.mode}
              aria-describedby="age-mode-description"
            >
              <legend>{strings.parents.ageModeTitle}</legend>
              <p id="age-mode-description">
                {strings.parents.ageModeDescription}
              </p>
              <div className={styles.modes}>
                {(['junior', 'senior'] as const).map((value) => (
                  <label key={value} className={styles.modeOption}>
                    <input
                      className="visuallyHidden"
                      type="radio"
                      name="age-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => onModeChange(value)}
                    />
                    <span>{strings.parents[value]}</span>
                    <Icon name="check" />
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
          <section>
            <h2>{strings.parents.aboutTitle}</h2>
            <p className={styles.intro}>{strings.parents.about}</p>
            <p>{strings.parents.howToPlay}</p>
            <p>{strings.parents.noRewards}</p>
            <p>{strings.parents.supplement}</p>
          </section>
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
            <p>{strings.parents.privacyIntro}</p>
            <ul>
              <li>{strings.parents.noProgress}</li>
              <li>{strings.parents.noPersonalData}</li>
              <li>{strings.parents.noAnalytics}</li>
              <li>{strings.parents.noPermissions}</li>
            </ul>
            <p>{strings.parents.localData}</p>
            <p>{strings.parents.hosting}</p>
          </section>
          <section>
            <h2>{strings.parents.importantTitle}</h2>
            <p>{strings.parents.supervision}</p>
            <p>{strings.parents.adultResponsibility}</p>
            <p>{strings.parents.noGuarantee}</p>
            <p>{strings.parents.liability}</p>
          </section>
          <section>
            <h2>{strings.parents.materialsTitle}</h2>
            <p>{strings.parents.materials}</p>
          </section>
          <p className={styles.version}>
            {strings.app.name} · {strings.parents.version} {version}
          </p>
        </div>
      </div>
    </dialog>
  );
}
