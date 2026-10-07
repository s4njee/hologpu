import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1200, height: 900 },
    launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] },
  },
  projects: [
    { name: 'swiftshader', use: { browserName: 'chromium' } },
    { name: 'swiftshader-dpr2', use: { browserName: 'chromium', deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env['CI'],
  },
});
