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
  // Cap workers at 2 for the three-engine matrix. Playwright's default (~50% of
  // logical cores) launches enough parallel WebKit/Firefox processes that a
  // headless browser process turns unstable under memory pressure — seen on
  // Windows as a hard crash (exit 0xC0000409) or a sporadically failing,
  // unrelated spec. 2 runs the full matrix reliably on both a dev machine and
  // the 2-core CI runners, for ~30s more wall-clock than 4.
  workers: 2,
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
  // Three engines: the app is a hand-rolled, zero-build SPA (WebGL cockpit,
  // SSE streaming, CSS custom properties, HTMLRewriter-fed metadata), so it is
  // exercised on Chromium, Firefox and WebKit to catch engine-specific breakage
  // before an operator hits it. WebKit is the Safari stand-in.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
