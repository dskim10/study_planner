import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './firebase-e2e',
  outputDir: './test-results-firebase',
  workers: 1,
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    baseURL: 'http://127.0.0.1:5174', timezoneId: 'Asia/Seoul', locale: 'ko-KR',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev:emulator', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
});
