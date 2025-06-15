/**
 * Router — hash-based SPA routing with smooth view transitions.
 *
 * Routes are simple objects mapping path → loader.
 * Each page is a module that mounts into #app and unmounts on route change.
 *
 * @module router
 */

'use strict';

import { Emitter } from './utils.js';

class Router extends Emitter {
  constructor() {
    super();
    this.routes = new Map();
    this.current = null;
    this.currentPage = null;
    this.transitioning = false;
    this.scrollPositions = new Map();
    this.app = null;
    this.nav = null;
  }

  /** Register a route. */
  register(path, handler) {
    this.routes.set(path, handler);
  }

  /** Initialise. */
  init(appEl, navEl) {
    this.app = appEl;
    this.nav = navEl;
    window.addEventListener('hashchange', () => this.resolve());
    window.addEventListener('popstate', () => this.resolve());
    // Intercept clicks on internal links
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-route]');
      if (link) {
        e.preventDefault();
        const path = link.getAttribute('data-route') || link.getAttribute('href');
        this.navigate(path);
      }
    });
    this.resolve();
  }

  /** Navigate to a route. */
  async navigate(path) {
    if (this.transitioning) return;
    if (this.current === path) return;
    if (this.current) {
      window.location.hash = path;
      return;
    }
    window.location.hash = path;
  }

  /** Resolve current route. */
  async resolve() {
    if (this.transitioning) return;
    const path = window.location.hash.slice(1) || '/';
    const handler = this.routes.get(path) || this.routes.get('/');

    // Save current scroll position
    if (this.current) {
      this.scrollPositions.set(this.current, window.scrollY);
    }

    this.transitioning = true;

    // Fade out current
    if (this.currentPage && this.currentPage.unmount) {
      try { this.currentPage.unmount(); } catch (e) { console.warn('unmount error', e); }
    }
    this.app.classList.add('is-leaving');
    await sleep(280);

    // Clear app
    this.app.innerHTML = '';

    // Mount new
    this.app.classList.remove('is-leaving');
    this.app.classList.add('is-entering');
    try {
      const page = await handler(this.app);
      this.currentPage = page;
    } catch (e) {
      console.error('page mount failed', path, e);
      this.app.innerHTML = `<div class="page-error"><div class="page-error__title">Page failed to load</div><div class="page-error__msg">${e.message}</div><a href="/" class="btn btn--primary">Back to home</a></div>`;
    }

    this.app.classList.remove('is-entering');

    // Update nav active state
    if (this.nav) {
      this.nav.querySelectorAll('[data-route]').forEach((el) => {
        const route = el.getAttribute('data-route') || el.getAttribute('href');
        el.classList.toggle('is-active', route === path);
      });
    }
    // Scroll to top on route change
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Restore scroll
    const saved = this.scrollPositions.get(path);
    window.scrollTo({ top: saved || 0, behavior: 'instant' });

    this.current = path;
    this.transitioning = false;
    this.emit('change', path);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const router = new Router();