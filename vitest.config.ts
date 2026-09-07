import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'tests/integration/**/*.test.ts',
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
        'scripts/lib/**/*.ts',
        'src/domain/game/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        'src/domain/game/**/*.ts': { lines: 90, branches: 90, perFile: true },
      },
    },
  },
});
