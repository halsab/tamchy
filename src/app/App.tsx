import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { usePwa } from '../services/pwa/use-pwa.ts';
import data from '../content/catalog.json';
import type { Catalog, Category } from '../content/types.ts';
import {
  useGameSession,
  type GameSessionOptions,
} from '../features/game/use-game-session.ts';
import { HomeScreen } from '../features/home/HomeScreen.tsx';
import { GameScreen } from '../features/game/GameScreen.tsx';
import { ParentsScreen } from '../features/parents/ParentsScreen.tsx';
import { readRoute, writeRoute, type Route } from './routes.ts';
import styles from './App.module.css';
import {
  readAgeMode,
  writeAgeMode,
  type AgeMode,
} from '../services/preferences/age-mode.ts';

const { categories } = data as Catalog;
export function App({ options }: { options?: GameSessionOptions }) {
  const game = useGameSession(options);
  const { start, exit } = game;
  const [route, setRoute] = useState<Route>(
    () => readRoute(location.hash) ?? 'home',
  );
  const pwa = usePwa(route === 'parents');
  const activeRoute = useRef<Route | null>(null);
  const main = useRef<HTMLElement>(null);
  const parentsButton = useRef<HTMLButtonElement>(null);
  const [ageMode, setAgeMode] = useState(readAgeMode);
  const afterSheetClose = useCallback(() => {
    (parentsButton.current ?? main.current)?.focus({ preventScroll: true });
  }, []);
  function changeAgeMode(mode: AgeMode) {
    setAgeMode(mode);
    writeAgeMode(mode);
  }
  const synchronize = useCallback(
    (next: Route, sayGoodbye = false) => {
      if (activeRoute.current !== next) {
        exit(sayGoodbye);
        activeRoute.current = next;
        const category = categories.find((category) => category.id === next);
        if (category) start(category, false);
      }
      setRoute(next);
    },
    [start, exit],
  );

  useLayoutEffect(() => {
    let attached = true;
    const read = () => {
      const next = readRoute(location.hash);
      if (next === null) writeRoute('home', true);
      synchronize(next ?? 'home');
    };
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    // Прямой вход выполняется после пробного setup/cleanup StrictMode.
    queueMicrotask(() => {
      if (attached) read();
    });
    return () => {
      attached = false;
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, [synchronize]);

  useLayoutEffect(() => {
    if (route !== 'parents') main.current?.focus({ preventScroll: true });
  }, [route]);

  function navigate(next: Route, sayGoodbye = false) {
    writeRoute(next);
    synchronize(next, sayGoodbye);
  }
  function enter(category: Category) {
    start(category);
    activeRoute.current = category.id;
    navigate(category.id);
  }
  const category = categories.find((category) => category.id === route);
  const home = () => navigate('home', true);
  return (
    <main
      ref={main}
      tabIndex={-1}
      className={styles.root}
      onPointerDownCapture={(event) => {
        if (
          category &&
          event.target instanceof Element &&
          !event.target.closest('button:not(:disabled)')
        )
          game.activity();
      }}
      onKeyDownCapture={() => {
        if (category) game.activity();
      }}
    >
      <div
        className={styles.screen}
        inert={route === 'parents'}
        aria-hidden={route === 'parents' ? true : undefined}
      >
        {category ? (
          <GameScreen category={category} game={game} onHome={home} />
        ) : (
          <HomeScreen
            categories={categories}
            onStart={enter}
            onParents={() => navigate('parents')}
            parentsButton={parentsButton}
          />
        )}
      </div>
      <ParentsScreen
        open={route === 'parents'}
        onHome={home}
        onClosed={afterSheetClose}
        mode={ageMode}
        onModeChange={changeAgeMode}
        version={`${import.meta.env.VITE_APP_VERSION} · ${import.meta.env.VITE_APP_RELEASE ?? ''}`}
        pwa={pwa.state}
        onRetry={pwa.retry}
        onInstall={pwa.install}
      />
    </main>
  );
}
