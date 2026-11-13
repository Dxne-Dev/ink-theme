import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 25_000,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/tmp/chromium',
      args: ['--no-sandbox', '--disable-gpu'],
    },
  },
  webServer: {
    command: 'npm run preview -- --host 0.0.0.0 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
