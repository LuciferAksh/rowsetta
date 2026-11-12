import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-browser',
  // This is a portability smoke; F18 startup budgets use headed Chromium separately.
  timeout: 300_000,
  expect: { timeout: 240_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        headless: false,
        launchOptions: {
          args: ['--enable-unsafe-webgpu'],
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        },
      },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command:
      'uv run python -m http.server 4173 --bind 127.0.0.1 --directory site',
    cwd: '..',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
