import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { contentPlugin } from './scripts/lib/content-plugin.ts';

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), contentPlugin(mode === 'check')],
  build: {
    outDir: mode === 'check' ? '.build-check' : 'dist',
    target: ['safari17', 'chrome111', 'firefox114'],
    cssTarget: ['safari17', 'chrome111', 'firefox114'],
    copyPublicDir: false,
  },
}));
