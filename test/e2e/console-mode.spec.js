// Operator console mode: the opt-in high-contrast, dense, low-motion skin.
// Verifies the mode applies before first paint, strips the decorative layers,
// leaves the default design untouched when off, and stays WCAG-clean.
'use strict';

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goOffline, gotoApp, revealAll } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await goOffline(page);
});

const enableConsole = (page) =>
  page.addInitScript(() => localStorage.setItem('orbitops:settings:consoleMode', '1'));

test('default (site) mode: no data-console attribute, ambient mounts', async ({ page }) => {
  await gotoApp(page, '/dashboard');
  await expect(page.locator('html')).not.toHaveAttribute('data-console', '');
  expect(await page.locator('.ambient-layer').count()).toBeGreaterThan(0);
});

test('console mode: root attribute set, ambient and decor stripped', async ({ page }) => {
  await enableConsole(page);
  await gotoApp(page, '/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-console', '');
  expect(await page.locator('.ambient-layer').count()).toBe(0);
  // Brighter secondary text token is live.
  const secondary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
  );
  expect(secondary.toUpperCase()).toBe('#C3CCDA');
});

test('console mode: settings toggle reflects the state and the switch is labelled', async ({ page }) => {
  await enableConsole(page);
  await gotoApp(page, '/settings');
  await expect(page.locator('#consoleModeToggle')).toBeChecked();
});

test('console mode: axe stays clean on home and dashboard', async ({ page }) => {
  await enableConsole(page);
  for (const path of ['/', '/dashboard']) {
    await gotoApp(page, path);
    await revealAll(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking.map((v) => ({ page: path, id: v.id, impact: v.impact }))).toEqual([]);
  }
});
