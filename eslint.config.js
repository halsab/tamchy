import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores([
    'dist/**',
    '.build-check/**',
    'coverage/**',
    '.release/**',
    'reports/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['node:*', '**/scripts/**', '**/assets-source/**'],
          paths: ['sharp', 'zod', 'vite', '@vitejs/plugin-react'],
        },
      ],
    },
  },
  {
    files: ['src/domain/game/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./[a-z-]+\\.ts$|\\.\\./\\.\\./content/types\\.ts$)',
              message:
                'Домен импортирует только свои модули и существующие типы контента.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'Date', 'globalThis'],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Передайте источник случайности генератору как зависимость.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Домен не загружает внешние модули.',
        },
      ],
    },
  },
]);
