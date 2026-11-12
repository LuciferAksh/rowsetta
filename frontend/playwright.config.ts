import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { E2E_TOKEN, SLOW_REFIT_DELAY_MS, SLOW_REFIT_PORT } from './e2e/session';

// Sessions go to a scratch directory, never beside a user's own in the home
// directory. Workers load this file again with the runner's environment, so
// one directory serves the whole run.
process.env.TABSTUDIO_E2E_SESSIONS ??= mkdtempSync(
  join(tmpdir(), 'tabstudio-e2e-'),
);
const SESSIONS = process.env.TABSTUDIO_E2E_SESSIONS;

function serverEnv(server: string): Record<string, string> {
  return {
    TABSTUDIO_TEACHER: 'fake',
    TABSTUDIO_SESSION_TOKEN: E2E_TOKEN,
    TABSTUDIO_STATES: '1',
    TABSTUDIO_SESSIONS_DIR: join(SESSIONS, server),
  };
}

export default defineConfig({
  testDir: './e2e',
  // Each server holds one workspace, so tests that edit it run one at a time.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: [
    {
      command: 'uv run rowsetta demo --no-browser --port 8787',
      url: 'http://127.0.0.1:8787/health',
      env: serverEnv('main'),
      reuseExistingServer: false,
    },
    {
      command: `uv run rowsetta demo --no-browser --port ${String(SLOW_REFIT_PORT)}`,
      url: `http://127.0.0.1:${String(SLOW_REFIT_PORT)}/health`,
      env: {
        ...serverEnv('slow-refit'),
        TABSTUDIO_FAKE_DELAY_MS: String(SLOW_REFIT_DELAY_MS),
      },
      reuseExistingServer: false,
    },
  ],
});
