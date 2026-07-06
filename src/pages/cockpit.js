// @ts-check
/**
 * Full-screen cockpit page.
 *
 * Mounts the immersive cockpit to fill the entire viewport.
 */

'use strict';

import { mountCockpit } from '../ui/cockpit-immersive.js';

/**
 * cockpit-v2.css is cockpit-only (all `.cockpit-*` / `.hud*` selectors), so it
 * is injected on demand here instead of loading globally on every route. The
 * 20 KB sheet lands well before three.js finishes importing, so there is no
 * flash of unstyled cockpit. Idempotent — reused across re-mounts.
 */
function ensureStyles() {
  if (document.getElementById('cv2-styles')) return;
  const link = document.createElement('link');
  link.id = 'cv2-styles';
  link.rel = 'stylesheet';
  link.href = '/src/styles/cockpit-v2.css';
  document.head.appendChild(link);
}

/** @param {HTMLElement} app */
export async function mount(app) {
  ensureStyles();
  app.innerHTML = '<div id="cockpitFull"></div>';
  app.classList.add('cockpit-page', 'page-bg', 'page-bg--cockpit');
  const THREE = await import('three');
  const page = await mountCockpit(/** @type {HTMLElement} */ (app.querySelector('#cockpitFull')), THREE);
  return {
    unmount() {
      app.classList.remove('cockpit-page', 'page-bg', 'page-bg--cockpit');
      page?.unmount?.();
    },
  };
}