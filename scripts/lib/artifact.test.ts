import { expect, it } from 'vitest';
import { assertBudgets, readPrecache } from './artifact.ts';
it('извлекает фактический precache из generateSW без выполнения кода', () => {
  expect(
    readPrecache(
      'define([],function(w){w.precacheAndRoute([{url:"index.html",revision:"a",integrity:"sha256-b"}],{});});',
    ),
  ).toEqual([{ url: 'index.html', revision: 'a', integrity: 'sha256-b' }]);
  expect(() => readPrecache('const x = [];')).toThrow();
});
it.each([
  'js',
  'css',
  'firstScreen',
  'complete',
  'illustration',
  'neutralIllustration',
] as const)('отклоняет превышение бюджета %s', (key) => {
  const sizes = {
    js: 0,
    css: 0,
    firstScreen: 0,
    complete: 0,
    illustration: 0,
    neutralIllustration: 0,
  };
  expect(() => assertBudgets(sizes)).not.toThrow();
  sizes[key] = 9 * 1024 * 1024;
  expect(() => assertBudgets(sizes)).toThrow(key);
});
