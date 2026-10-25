import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['layout.spec.ts', 'animation.spec.ts'], workers: 1,
  projects: (process.env.REVIEW_BROWSER ? [process.env.REVIEW_BROWSER] : ['chromium']).map(name => ({name, use: {browserName: name as 'chromium' | 'webkit' | 'firefox'}})),
  use: { baseURL: 'http://127.0.0.1:5173', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
