import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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

const { categories } = data as Catalog;
export function App({ options }: { options?: GameSessionOptions }) {
  const game = useGameSession(options);
  const { start, exit } = game;
  const [route, setRoute] = useState<Route>(
    () => readRoute(location.hash) ?? 'home',
  );
  const activeRoute = useRef<Route | null>(null);
  const main = useRef<HTMLElement>(null);
  const synchronize = useCallback(
    (next: Route) => {
      if (activeRoute.current !== next) {
        exit();
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
    main.current?.focus({ preventScroll: true });
  }, [route]);

  function navigate(next: Route) {
    writeRoute(next);
    synchronize(next);
  }
  function enter(category: Category) {
    start(category);
    activeRoute.current = category.id;
    navigate(category.id);
  }
  const category = categories.find((category) => category.id === route);
  const home = () => navigate('home');
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
      {category ? (
        <GameScreen category={category} game={game} onHome={home} />
      ) : route === 'parents' ? (
        <ParentsScreen
          onHome={home}
          version={import.meta.env.VITE_APP_VERSION}
        />
      ) : (
        <HomeScreen
          categories={categories}
          onStart={enter}
          onParents={() => navigate('parents')}
        />
      )}
    </main>
  );
}
