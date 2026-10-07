import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testIgnore: '**/pixels.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 1200, height: 900 } },
  projects: [
    { name: 'chrome-hardware', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox-hardware', use: { browserName: 'firefox', headless: false } },
    { name: 'webkit-hardware', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env['CI'],
  },
});
