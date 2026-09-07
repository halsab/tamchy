import project from './package.json' with { type: 'json' };
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(project.version),
  },
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: [
        ['text', { skipFull: false }],
        'text-summary',
        'json',
        'json-summary',
        'html',
        'clover',
      ],
      include: [
        'src/services/assets/**/*.ts',
        'src/services/audio/**/*.ts',
        'src/services/pwa/**/*.ts',
        'src/features/**/*.{ts,tsx}',
        'src/app/**/*.{ts,tsx}',
        'src/shared/ui/**/*.tsx',
        'scripts/lib/**/*.ts',
        'src/domain/game/**/*.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}'],
      thresholds: {
        'src/domain/game/**/*.ts': { lines: 90, branches: 90, perFile: true },
      },
    },
  },
});
