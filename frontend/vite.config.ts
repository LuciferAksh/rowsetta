import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The local server, as `tabular-studio demo --port 8787` starts it.
const BACKEND = 'http://127.0.0.1:8787';

// The backend serves its API beside the page at the root, so the dev server
// forwards each API path and keeps `/` and its own module paths.
const API_PATHS = [
  '/audit',
  '/columns',
  '/distill',
  '/eval',
  '/events',
  '/export',
  '/health',
  '/labels',
  '/session',
  '/state',
  '/table',
  '/target',
  '/threshold',
  '/undo',
];

export default defineConfig({
  plugins: [svelte()],
  // The Python package serves this directory; the wheel build packs it.
  build: { outDir: '../src/tabular_studio/static', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(API_PATHS.map((path) => [path, BACKEND])),
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
