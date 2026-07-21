// Shared e2e helpers.
'use strict';

/**
 * Block every request that leaves the test server, so runs are deterministic
 * and fully offline: CelesTrak fetches fail fast (the app falls back to the
 * bundled TLE snapshot — a real, supported path), and no fonts/CDNs are hit.
 * @param {import('@playwright/test').Page} page
 */
export async function goOffline(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

/**
 * Navigate and wait for the SPA to mount a page into #app (the router clears
 * and repopulates it; non-empty means the page module finished mounting).
 * @param {import('@playwright/test').Page} page
 * @param {string} path
 */
export async function gotoApp(page, path) {
  await page.goto(path);
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return !!app && app.children.length > 0;
  });
}

/**
 * Scroll through the whole page so scroll-reveal animations fire and settle,
 * then return to the top. Audits must measure the state a reader actually
 * sees — below the fold, pre-reveal elements sit at their dimmed starting
 * styles, which is presentation-in-motion, not the presented page.
 * @param {import('@playwright/test').Page} page
 */
export async function revealAll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    const max = () => document.body.scrollHeight - window.innerHeight;
    for (let y = 0; y <= max(); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, max());
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
}
