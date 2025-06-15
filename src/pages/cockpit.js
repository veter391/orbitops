/**
 * Full-screen cockpit page.
 *
 * Mounts the immersive cockpit to fill the entire viewport.
 */

'use strict';

import { mountCockpit } from '../ui/cockpit-immersive.js';

export async function mount(app) {
  app.innerHTML = '<div id="cockpitFull"></div>';
  app.classList.add('cockpit-page', 'page-bg', 'page-bg--cockpit');
  const THREE = await import('three');
  const page = await mountCockpit(app.querySelector('#cockpitFull'), THREE);
  return {
    unmount() {
      app.classList.remove('cockpit-page');
      page?.unmount?.();
    },
  };
}