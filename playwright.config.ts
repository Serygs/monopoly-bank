import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;

// The screenshot-baseline project is opt-in (`npm run test:visual`): its baselines are
// machine-specific, and gating it keeps `npm run test:e2e` from building and serving the app.
const visualRun = process.env.PLAYWRIGHT_VISUAL === '1';
const visualPort = 4173;
const visualBaseURL = `http://127.0.0.1:${visualPort}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/e2e/visual/**'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter:
    process.env.CI === undefined
      ? 'list'
      : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(visualRun
      ? [
          {
            name: 'visual',
            testDir: './e2e/visual',
            testIgnore: [],
            fullyParallel: true,
            snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
            use: {
              ...devices['Desktop Chrome'],
              baseURL: visualBaseURL,
              locale: 'en-US',
              timezoneId: 'UTC',
              serviceWorkers: 'block' as const,
              trace: 'off' as const,
              video: 'off' as const,
            },
          },
        ]
      : []),
  ],
  webServer: visualRun
    ? {
        command: `npm run preview -- --host 127.0.0.1 --port ${visualPort} --strictPort`,
        url: visualBaseURL,
        reuseExistingServer: process.env.CI === undefined,
        timeout: 240_000,
      }
    : undefined,
});
