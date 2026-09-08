export type AgeMode = 'junior' | 'senior';

const key = 'tamchy.age-mode';

export function readAgeMode(): AgeMode {
  try {
    return window.localStorage.getItem(key) === 'senior' ? 'senior' : 'junior';
  } catch {
    return 'junior';
  }
}

export function writeAgeMode(mode: AgeMode): void {
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // При отказе хранилища выбранный режим остаётся в памяти приложения.
  }
}
