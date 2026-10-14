import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

const remoteBaseURL = process.env['FLUID_DOM_BASE_URL'];
export default defineConfig({
  ...base,
  testMatch: 'fluid-dom.spec.ts',
  timeout: 120000,
  expect: { timeout: 60000 },
  projects: [
    ...base.projects!,
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        headless: false,
        launchOptions: {
          args: [],
          firefoxUserPrefs: { 'dom.webgpu.enabled': true, 'dom.webgpu.force-enabled': true },
        },
      },
    },
  ],
  use: { ...base.use, baseURL: remoteBaseURL ?? 'http://127.0.0.1:5179' },
  webServer: remoteBaseURL
    ? undefined
    : {
        command:
          'pnpm --filter @mk7s/hologpu-playground exec vite preview --host 127.0.0.1 --port 5179',
        url: 'http://127.0.0.1:5179',
        reuseExistingServer: !process.env['CI'],
      },
});
