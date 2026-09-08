import { expect, it } from 'vitest';
import { classifyChanges } from './ci-scope.ts';

it('ограничивает чистую документацию короткой проверкой', () => {
  expect(classifyChanges(['README.md', 'AGENTS.md', 'docs/testing.md'])).toBe(
    'docs',
  );
});
it('проверяет инфраструктуру отдельно от неизменённого приложения', () => {
  expect(
    classifyChanges([
      '.github/workflows/deploy.yml',
      'scripts/lib/deployment.ts',
      'docs/release.md',
    ]),
  ).toBe('tooling');
});
it.each([
  'src/app/App.tsx',
  'src/content/v2/audio.json',
  'assets-source/animals/animal-cat.png',
  'public/assets/audio/tt/x.mp3',
  'scripts/prepare-assets.ts',
  'scripts/lib/asset-cache.ts',
  'scripts/test-e2e.ts',
  'playwright.config.ts',
  'package-lock.json',
  '.nvmrc',
  'unknown.txt',
])('сохраняет полную приёмку для %s', (path) => {
  expect(classifyChanges(['docs/testing.md', path])).toBe('app');
});
it('не считает неизвестный или пустой diff готовым выпуском', () => {
  expect(classifyChanges([])).toBe('app');
});
