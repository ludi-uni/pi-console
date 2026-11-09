import { defineConfig } from '@playwright/test';

// Mocked APIs only: no Console runtime, SDK workers, or provider calls.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['retention.spec.ts', 'chat-rendering.spec.ts', 'prompt-session-switch.spec.ts'],
  timeout: 60000,
  workers: 1,
  outputDir: 'test-results/retention',
  use: { baseURL: 'http://127.0.0.1:31720', headless: true, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', ...(process.env.PI_CONSOLE_TEST_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.PI_CONSOLE_TEST_CHROMIUM_EXECUTABLE } } : { channel: 'chrome' }) } },
    // Android device-emulation fixtures in prompt-session-switch are Chromium-only.
    { name: 'firefox', testMatch: ['retention.spec.ts', 'chat-rendering.spec.ts'], use: { browserName: 'firefox' } },
    { name: 'webkit', testMatch: ['retention.spec.ts', 'chat-rendering.spec.ts'], use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 31720 --strictPort',
    url: 'http://127.0.0.1:31720', reuseExistingServer: false, timeout: 30000,
  },
});
