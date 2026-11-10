import { defineConfig } from '@playwright/test';
import { E2E_TOKEN, SLOW_REFIT_DELAY_MS, SLOW_REFIT_PORT } from './e2e/session';

const SERVER_ENV = {
  TABSTUDIO_TEACHER: 'fake',
  TABSTUDIO_SESSION_TOKEN: E2E_TOKEN,
  TABSTUDIO_STATES: '1',
};

export default defineConfig({
  testDir: './e2e',
  // Each server holds one workspace, so tests that edit it run one at a time.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: [
    {
      command: 'uv run tabular-studio demo --no-browser --port 8787',
      url: 'http://127.0.0.1:8787/health',
      env: SERVER_ENV,
      reuseExistingServer: false,
    },
    {
      command: `uv run tabular-studio demo --no-browser --port ${String(SLOW_REFIT_PORT)}`,
      url: `http://127.0.0.1:${String(SLOW_REFIT_PORT)}/health`,
      env: {
        ...SERVER_ENV,
        TABSTUDIO_FAKE_DELAY_MS: String(SLOW_REFIT_DELAY_MS),
      },
      reuseExistingServer: false,
    },
  ],
});
