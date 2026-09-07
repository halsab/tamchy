import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const base = process.env.VITE_BASE ?? '/';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: join(
    process.env.TAMCHY_E2E_REPORTS ?? join(tmpdir(), 'tamchy-e2e'),
    base === '/' ? 'root' : 'subpath',
  ),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 3,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:4173${base}`,
    viewport: { width: 1024, height: 768 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: `http://127.0.0.1:4173${base}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
