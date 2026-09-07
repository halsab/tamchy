import { describe, expect, it } from 'vitest';
import { isAssetPath, resolveAssetUrl } from './paths.ts';

describe('URL ресурсов', () => {
  const path = 'assets/images/animals/animal-cat.webp';

  it.each([
    ['/', '/assets/images/animals/animal-cat.webp'],
    ['/tamchy/', '/tamchy/assets/images/animals/animal-cat.webp'],
    [
      '/nested/project/',
      '/nested/project/assets/images/animals/animal-cat.webp',
    ],
  ])('учитывает base %s', (base, expected) => {
    expect(resolveAssetUrl(path, base)).toBe(expected);
  });

  it.each([
    'https://evil.test/a',
    '//evil.test/a',
    '/assets/a',
    '../a',
    'assets/../a',
    'assets/%2e%2e/a',
    'assets\\a',
    'public/assets/a',
    'dist/a',
    'assets-source/a',
    'assets/a?x=1',
    'assets/A.webp',
    'assets//a.webp',
  ])('отклоняет небезопасный путь %s', (path) => {
    expect(isAssetPath(path)).toBe(false);
    expect(() => resolveAssetUrl(path, '/')).toThrow();
  });

  it('разрешает путь записи и иконки', () => {
    expect(
      resolveAssetUrl('assets/audio/tt/colors/color-red-label.mp3', '/tamchy/'),
    ).toBe('/tamchy/assets/audio/tt/colors/color-red-label.mp3');
    expect(isAssetPath('icons/apple-touch-icon.png')).toBe(true);
  });

  it.each(['https://evil.test/', '//evil.test/', '/a/../', '/tamchy', './'])(
    'отклоняет неподдерживаемый base %s',
    (base) => {
      expect(() => resolveAssetUrl(path, base)).toThrow();
    },
  );
});
