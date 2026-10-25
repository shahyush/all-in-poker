import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir: './layout-results', testDir: './e2e', testMatch: ['layout.spec.ts', 'animation.spec.ts', 'flows.spec.ts'], workers: 1,
  projects: (process.env.REVIEW_BROWSER ? [process.env.REVIEW_BROWSER] : ['chromium']).map(name => ({name, use: {browserName: name as 'chromium' | 'webkit' | 'firefox'}})),
  use: { baseURL: 'http://127.0.0.1:5173', screenshot: 'only-on-failure' },
  webServer: { command: 'VITE_DEV_API=http://127.0.0.1:8787 npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
