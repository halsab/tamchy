import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores(['dist/**', '.build-check/**', 'coverage/**']),
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
]);
