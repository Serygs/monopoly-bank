import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { cloudflare } from '@cloudflare/vite-plugin';

import { serviceWorkerPlugin } from './pwa/service-worker-plugin.ts';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Unit tests use mocked Worker/D1 boundaries and must not open a remote
  // Cloudflare development session in non-interactive CI.
  plugins:
    mode === 'test'
      ? [react(), tailwindcss()]
      : [react(), tailwindcss(), cloudflare(), serviceWorkerPlugin()],
  // Hashed build output only, so `public/_headers` can cache it forever without also pinning
  // the unhashed files under `public/assets/themes/`.
  build: { assetsDir: 'assets/build' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test-results/**', 'e2e/**', '.claude/**'],
    // Worker, shared and migration tests run in Node: jsdom replaces globals such as `URL`,
    // which breaks `new URL('./file.sql', import.meta.url)` in the migration tests.
    projects: [
      { extends: true, test: { name: 'dom', include: ['src/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { name: 'node', environment: 'node', exclude: ['src/**'] } },
    ],
  },
}));
