// @ts-check
/**
 * Full-screen cockpit page.
 *
 * Mounts the immersive cockpit to fill the entire viewport.
 */

'use strict';

import { mountCockpit } from '../ui/cockpit-immersive.js';

/** @param {HTMLElement} app */
export async function mount(app) {
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