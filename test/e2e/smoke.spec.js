// End-to-end smoke suite: every primary route mounts with its real content,
// client-side navigation works, deep links resolve through the SPA fallback,
// and the mobile menu behaves. Fully offline — external hosts are blocked, so
// the catalog exercises the bundled-snapshot path deterministically.
'use strict';

import { test, expect } from '@playwright/test';
import { goOffline, gotoApp } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await goOffline(page);
});

test('home mounts with the hero and the correct title', async ({ page }) => {
  await gotoApp(page, '/');
  await expect(page.locator('.hv3-hero__title')).toContainText('Mission control');
  await expect(page).toHaveTitle(/OrbitOps/);
});

test('client-side navigation reaches every primary route', async ({ page }) => {
  await gotoApp(page, '/');
  const routes = [
    ['/cockpit', 'Cockpit — OrbitOps'],
    ['/agent', 'AI Agent — OrbitOps'],
    ['/dashboard', 'Dashboard — OrbitOps'],
    ['/tools', 'Flight tools — OrbitOps'],
    ['/docs', 'Docs — OrbitOps'],
  ];
  for (const [route, title] of routes) {
    await page.click(`.top-nav__links a[data-route="${route}"]`);
    await expect(page).toHaveTitle(title);
    await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return !!app && app.children.length > 0;
    });
  }
});

test('cockpit deep link renders the 3D scene from the bundled snapshot', async ({ page }) => {
  await gotoApp(page, '/cockpit');
  // The Three.js scene mounts a canvas; the catalog loads from the offline
  // snapshot because external hosts are blocked in this suite.
  await expect(page.locator('#app canvas').first()).toBeVisible({ timeout: 30_000 });
});

test('dashboard deep link computes real catalog analytics', async ({ page }) => {
  await gotoApp(page, '/dashboard');
  await expect(page.locator('.dv2-title')).toContainText('Constellation overview');
});

test('docs deep link opens and the sidebar switches articles', async ({ page }) => {
  await gotoApp(page, '/docs/going-live');
  const content = page.locator('#docsContent');
  await expect(content).toContainText(/backend/i);
  // Switch to another article via the sidebar.
  await page.click('.docs-sidebar__link[data-doc="quickstart"]');
  await expect(content).toContainText(/quick start/i);
});

test('tools, pricing and settings mount their real headers', async ({ page }) => {
  await gotoApp(page, '/tools');
  await expect(page.locator('.page-header__title')).toContainText('Flight instruments');
  await gotoApp(page, '/pricing');
  await expect(page.locator('.page-header__title')).toContainText('Per satellite');
  await gotoApp(page, '/settings');
  await expect(page.locator('.set-title')).toContainText('Settings');
});

test('mobile burger opens the menu and closes it when a tab is chosen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, '/');
  const nav = page.locator('.top-nav');
  await page.click('#topNavBurger');
  await expect(nav).toHaveClass(/is-mobile-open/);
  await page.click('.top-nav__links a[data-route="/dashboard"]');
  await expect(nav).not.toHaveClass(/is-mobile-open/);
  await expect(page).toHaveTitle('Dashboard — OrbitOps');
});
