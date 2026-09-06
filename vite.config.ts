import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Unit tests use mocked Worker/D1 boundaries and must not open a remote
  // Cloudflare development session in non-interactive CI.
  plugins: mode === 'test' ? [react()] : [react(), cloudflare()],
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test-results/**', 'e2e/**'],
  },
}))
