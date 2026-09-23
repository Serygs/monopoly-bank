import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // The staging gate: HTTPS, transactional email, invitations and guests. `property.spec.ts` belongs to the local project below.
    { name: 'chromium', testIgnore: /property\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // The local board run started by `npm run test:e2e:local` against a throwaway D1; never retried, one worker.
    { name: 'local', testMatch: /property\.spec\.ts/, retries: 0, use: { ...devices['Desktop Chrome'] } },
  ],
});
