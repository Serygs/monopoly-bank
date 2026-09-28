import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { cloudflare } from '@cloudflare/vite-plugin';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Unit tests use mocked Worker/D1 boundaries and must not open a remote
  // Cloudflare development session in non-interactive CI.
  plugins: mode === 'test' ? [react(), tailwindcss()] : [react(), tailwindcss(), cloudflare()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test-results/**', 'e2e/**'],
    // Worker, shared and migration tests run in Node: jsdom replaces globals such as `URL`,
    // which breaks `new URL('./file.sql', import.meta.url)` in the migration tests.
    projects: [
      { extends: true, test: { name: 'dom', include: ['src/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { name: 'node', environment: 'node', exclude: ['src/**'] } },
    ],
  },
}));
