// Accessibility gate: axe-core scans of the primary surfaces. The gate fails
// on any serious or critical violation — the same bar the project's Lighthouse
// a11y ~100 score reflects, but enforced in CI on every change.
'use strict';

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goOffline, gotoApp, revealAll } from './helpers.mjs';

const PAGES = ['/', '/dashboard', '/docs', '/settings', '/pricing', '/agent'];

test.beforeEach(async ({ page }) => {
  await goOffline(page);
});

for (const path of PAGES) {
  test(`axe: no serious/critical violations on ${path}`, async ({ page }) => {
    await gotoApp(page, path);
    await revealAll(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    ).toEqual([]);
  });
}
