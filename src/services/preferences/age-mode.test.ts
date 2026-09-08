// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readAgeMode, writeAgeMode } from './age-mode.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([null, '', 'unknown', '2', '{"mode":"senior"}'])(
  'неизвестное значение %s выбирает младший режим',
  (value) => {
    if (value !== null) localStorage.setItem('tamchy.age-mode', value);
    expect(readAgeMode()).toBe('junior');
  },
);

it.each(['junior', 'senior'] as const)('сохраняет только режим %s', (mode) => {
  localStorage.setItem('another-app', 'keep');
  writeAgeMode(mode);
  expect(readAgeMode()).toBe(mode);
  expect(localStorage.getItem('tamchy.age-mode')).toBe(mode);
  expect(localStorage.getItem('another-app')).toBe('keep');
  expect(localStorage.length).toBe(2);
});

it('отказ доступа к хранилищу не ломает чтение и выбор режима', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Denied', 'SecurityError');
  });
  expect(readAgeMode()).toBe('junior');
  expect(() => writeAgeMode('senior')).not.toThrow();
});

it('переполнение хранилища не ломает выбор режима', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  expect(() => writeAgeMode('senior')).not.toThrow();
});
