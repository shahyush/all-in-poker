import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { actionTimeout: 20_000, baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
  testIgnore: process.env.E2E_LIVE ? [] : ['**/live-smoke.spec.ts'],
  projects: process.env.E2E_LIVE
    ? [
        { name: 'live-webkit', testMatch: '**/live-smoke.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
        { name: 'live-chromium', testMatch: '**/live-smoke.spec.ts', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
      ]
    : [{ name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
});
