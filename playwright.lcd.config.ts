import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

// Verify the built demo without a development server's hot-reload connection.
const remoteBaseURL = process.env['LCD_BASE_URL'];
export default defineConfig({
  ...base,
  testMatch: 'lcd.spec.ts',
  timeout: 120000,
  expect: { timeout: 60000 },
  use: { ...base.use, baseURL: remoteBaseURL ?? 'http://127.0.0.1:5178' },
  webServer: remoteBaseURL
    ? undefined
    : {
        command:
          'pnpm --filter @mk7s/hologpu-playground exec vite preview --host 127.0.0.1 --port 5178',
        url: 'http://127.0.0.1:5178',
        reuseExistingServer: !process.env['CI'],
      },
});
