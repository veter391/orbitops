// Playwright configuration for the frontend e2e + accessibility suite.
// The suite runs against the zero-build static app served by test/e2e/server.mjs
// (SPA fallback + no-store). External hosts are blocked inside the specs, so
// runs are deterministic and offline: the catalog exercises the bundled
// snapshot path, exactly like a network-less operator install.
'use strict';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node test/e2e/server.mjs',
    port: 8123,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
