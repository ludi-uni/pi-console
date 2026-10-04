import { defineConfig } from '@playwright/test';

// Source-only UI tests: no Console server, Pi worker or model/provider calls.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['browser-compatibility.spec.ts', 'ux-review-regressions.spec.ts'],
  timeout: 30000,
  workers: 1,
  outputDir: 'test-results/compatibility',
  use: {
    baseURL: 'http://127.0.0.1:31719',
    headless: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 31719 --strictPort',
    url: 'http://127.0.0.1:31719',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
