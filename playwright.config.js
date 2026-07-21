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
  // Cap workers so the three-engine matrix (3× the specs) never oversubscribes
  // the machine. Playwright's default (~50% of logical cores) launches enough
  // parallel WebKit/Firefox processes on a many-core host that a headless
  // browser process can crash under memory pressure (observed on Windows:
  // exit 0xC0000409), failing an unrelated spec. 4 is well below that threshold
  // and verified stable across repeated full-matrix runs; CI runners get 2.
  workers: process.env.CI ? 2 : 4,
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
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        // Headless Firefox on Linux CI blocklists the GPU, which disables WebGL
        // and leaves the cockpit's Three.js scene with no <canvas> (the smoke
        // test then times out). Force WebGL on so it uses the software renderer
        // (Mesa/llvmpipe) — matching a real desktop Firefox, where WebGL is
        // available. A no-op where WebGL already works (e.g. local runs).
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.disabled': false,
          },
        },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
