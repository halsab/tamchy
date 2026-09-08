import type { CSSProperties } from 'react';
import type { CategoryDefinition } from '../../content/v2/types.ts';
import { isImageResource } from '../../domain/game/resources.ts';
import strings from '../../content/tt.json';
import { hasHint } from '../../domain/game/reducer.ts';
import type { GameSessionController } from './use-game-session.ts';
import { AnswerContent } from './AnswerContent.tsx';
import { HomeButton } from '../../shared/ui/HomeButton.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import controls from '../../shared/ui/controls.module.css';
import styles from './GameScreen.module.css';

export function GameScreen({
  category,
  game,
  onHome,
}: {
  category: CategoryDefinition;
  game: GameSessionController;
  onHome: () => void;
}) {
  const state =
    game.state?.session.categoryId === category.id &&
    game.state.status !== 'ended'
      ? game.state
      : null;
  const round = state?.round.mode === 'junior' ? state.round : null;
  const countObject = round?.kind === 'N1-A' ? round.countObject : undefined;
  const pixels =
    countObject?.kind === 'tinted'
      ? game.tintedPixels(countObject.image, countObject.hex)
      : undefined;
  const phase = state?.status === 'paused' ? state.resume : state;
  const accepted =
    phase?.status === 'correct' ||
    phase?.status === 'transitioning' ||
    (phase?.status === 'error' && phase.failure.phase === 'confirmation');
  const hint = state !== null && hasHint(state);
  const blocked =
    state?.status === 'error' && state.failure.reason === 'blocked';
  const blocking = state?.status === 'error' || state?.status === 'paused';
  return (
    <div
      className={styles.game}
      data-count={state?.round.options.length ?? 2}
      data-blocking={blocking}
      style={
        { '--answer-count': state?.round.options.length ?? 2 } as CSSProperties
      }
    >
      <header className={styles.header}>
        <HomeButton onClick={onHome} />
        <h1>{category.labelTt}</h1>
        <button
          className={controls.iconButton}
          onClick={game.repeat}
          disabled={
            !state ||
            (state.status !== 'awaiting' && state.status !== 'preparing')
          }
          aria-label={strings.action.listenAgain}
        >
          <Icon name="sound" />
        </button>
      </header>
      <p className={styles.prompt}>
        {state?.round.prompt.textTt ?? strings.status.loading}
      </p>
      <div
        className={styles.answers}
        role="group"
        aria-label={strings.game.answers}
      >
        {state &&
          round?.options.map((item) => {
            const { id } = item;
            const correct = accepted && id === state.round.correctOptionId;
            const hinted = hint && id === state.round.correctOptionId;
            const wrong =
              state.status === 'retrying' && state.selectedId === id;
            return (
              <button
                key={`${state.session.sessionId}:${state.round.id}:${id}`}
                className={`${styles.answer} ${correct ? styles.correct : ''} ${hinted ? styles.hint : ''} ${wrong ? styles.wrong : ''}`}
                disabled={state.status !== 'awaiting'}
                aria-label={item.labelTt}
                aria-describedby={hinted ? 'game-hint' : undefined}
                onClick={() => game.answer(id)}
              >
                <AnswerContent
                  item={item}
                  countObject={countObject}
                  pixels={pixels}
                  imageUrl={game.imageUrl}
                  onImageError={game.imageFailed}
                />
                {correct && !blocking && (
                  <span
                    className={styles.check}
                    role="img"
                    aria-label={strings.game.correct}
                  >
                    <Icon name="check" />
                  </span>
                )}
              </button>
            );
          })}
      </div>
      <div className={styles.feedback}>
        {accepted && blocking && (
          <span
            className={`${styles.check} ${styles.blockingCheck}`}
            role="img"
            aria-label={strings.game.correct}
          >
            <Icon name="check" />
          </span>
        )}
        {hint && (
          <span id="game-hint" className="visuallyHidden">
            {strings.game.hint}
          </span>
        )}
        {(!state ||
          state.status === 'preparing' ||
          state.status === 'transitioning') && (
          <p role="status">{strings.status.loading}</p>
        )}
        {state?.status === 'correct' && (
          <p role="status">{strings.game.correct}</p>
        )}
        {state?.status === 'retrying' && (
          <p role="status">{strings.game.tryAgain}</p>
        )}
        {state?.status === 'paused' && (
          <>
            <p>{strings.game.paused}</p>
            <button className={controls.action} onClick={game.continueGame}>
              <Icon name="play" />
              {strings.action.continue}
            </button>
          </>
        )}
        {state?.status === 'error' && (
          <>
            <p role={blocked ? 'status' : 'alert'}>
              {blocked
                ? strings.game.activate
                : isImageResource(state.failure.resource)
                  ? strings.error.load
                  : strings.error.audio}
            </p>
            <button className={controls.action} onClick={game.retry}>
              <Icon name={blocked ? 'play' : 'retry'} />
              {blocked ? strings.action.listen : strings.action.retry}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
