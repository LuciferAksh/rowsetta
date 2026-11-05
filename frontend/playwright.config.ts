import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: {
    command: 'uv run tabular-studio demo --no-browser --port 8787',
    url: 'http://127.0.0.1:8787/health',
    env: {
      TABSTUDIO_TEACHER: 'fake',
      TABSTUDIO_SESSION_TOKEN: 'e2e-only-token',
      TABSTUDIO_STATES: '1',
    },
    reuseExistingServer: false,
  },
});
