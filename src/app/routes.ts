import type { CategoryId } from '../content/types.ts';

export type Route = 'home' | 'parents' | CategoryId;
const hashes: Record<Route, string> = {
  home: '#/',
  colors: '#/colors',
  animals: '#/animals',
  numbers: '#/numbers',
  parents: '#/parents',
};

export function readRoute(hash: string): Route | null {
  return (
    (Object.keys(hashes) as Route[]).find((route) => hashes[route] === hash) ??
    null
  );
}

export function writeRoute(route: Route, replace = false) {
  if (location.hash === hashes[route]) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method](
    null,
    '',
    `${location.pathname}${location.search}${hashes[route]}`,
  );
}
