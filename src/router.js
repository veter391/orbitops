// @ts-check
/**
 * Router — hash-based SPA routing with smooth view transitions.
 *
 * Routes are simple objects mapping path → loader.
 * Each page is a module that mounts into #app and unmounts on route change.
 *
 * @module router
 */

'use strict';

import { Emitter, esc } from './utils.js';

class Router extends Emitter {
  constructor() {
    super();
    /** @type {Map<string, (app: HTMLElement) => any>} */
    this.routes = new Map();
    /** @type {string|null} */
    this.current = null;
    /** @type {{unmount?: () => void}|null} */
    this.currentPage = null;
    this.transitioning = false;
    /** @type {Map<string, number>} */
    this.scrollPositions = new Map();
    /** @type {HTMLElement|null} */
    this.app = null;
    /** @type {HTMLElement|null} */
    this.nav = null;
    /** @type {HTMLElement|null} */
    this._loader = null;
  }

  /** Register a route. @param {string} path @param {(app: HTMLElement) => any} handler */
  register(path, handler) {
    this.routes.set(path, handler);
  }

  /** Initialise. @param {HTMLElement} appEl @param {HTMLElement} [navEl] */
  init(appEl, navEl) {
    this.app = appEl;
    this.nav = navEl || null;
    window.addEventListener('hashchange', () => this.resolve());
    window.addEventListener('popstate', () => this.resolve());
    // Intercept clicks on internal links
    document.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement|null} */ (e.target);
      const link = target?.closest('a[data-route]');
      if (link) {
        e.preventDefault();
        const path = link.getAttribute('data-route') || link.getAttribute('href');
        if (path) this.navigate(path);
      }
    });
    this.resolve();
  }

  /** Navigate to a route. @param {string} path */
  async navigate(path) {
    if (this.transitioning) return;
    if (this.current === path) return;
    // The hashchange handler drives the actual route resolve() for both first
    // navigation and subsequent ones, so a single assignment is all that's needed.
    window.location.hash = path;
  }

  /** Resolve current route. */
  async resolve() {
    if (this.transitioning) return;
    const app = this.app;
    if (!app) return;
    const path = window.location.hash.slice(1) || '/';
    const handler = this.routes.get(path) || this.routes.get('/');
    if (!handler) return;

    // Save current scroll position
    if (this.current) {
      this.scrollPositions.set(this.current, window.scrollY);
    }

    this.transitioning = true;

    // Fade out current
    if (this.currentPage && this.currentPage.unmount) {
      try { this.currentPage.unmount(); } catch (e) { console.warn('unmount error', e); }
    }
    app.classList.add('is-leaving');
    await sleep(280);

    // Clear app
    app.innerHTML = '';

    // Mount new. Heavy routes (cockpit/tools pull three.js + build a scene +
    // fetch TLE) can take a beat; show a loader only if the mount runs past a
    // short threshold, so light pages never flash it.
    app.classList.remove('is-leaving');
    app.classList.add('is-entering');
    const loaderTimer = setTimeout(() => this._showLoader(), 220);
    try {
      const page = await handler(app);
      this.currentPage = page;
    } catch (e) {
      console.error('page mount failed', path, e);
      const msg = e instanceof Error ? e.message : String(e);
      app.innerHTML = `<div class="page-error"><div class="page-error__title">Page failed to load</div><div class="page-error__msg">${esc(msg)}</div><a href="/" class="btn btn--primary">Back to home</a></div>`;
    } finally {
      clearTimeout(loaderTimer);
      this._hideLoader();
    }

    app.classList.remove('is-entering');

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

    // A navigation that arrived while we were transitioning was dropped by the
    // guard at the top of resolve(). Reconcile now so the rendered page always
    // matches the current hash — otherwise a fast click-through leaves the URL
    // and view desynced (and one-shot chrome like the cursor-sat gets stuck on
    // the wrong route). resolve() is idempotent and terminates once the hash
    // settles, so this can't loop.
    const latest = window.location.hash.slice(1) || '/';
    if (latest !== this.current) this.resolve();
  }

  /**
   * Transient route loader — reuses the boot screen's visual language (same
   * orbital mark + mono type from the inline critical CSS) so a slow mount
   * reads as "still working", never a blank void. Only ever shown via the
   * delayed timer in resolve(), so fast pages skip it entirely.
   */
  _showLoader() {
    if (this._loader) return;
    const el = document.createElement('div');
    el.className = 'boot';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="boot__inner">
        <svg class="boot__mark" viewBox="0 0 64 64" fill="none">
          <ellipse cx="32" cy="32" rx="28" ry="10" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
          <ellipse cx="32" cy="32" rx="28" ry="10" stroke="currentColor" stroke-width="1.5" opacity="0.5" transform="rotate(60 32 32)"/>
          <ellipse cx="32" cy="32" rx="28" ry="10" stroke="currentColor" stroke-width="1.5" opacity="0.5" transform="rotate(-60 32 32)"/>
          <circle cx="32" cy="32" r="6" fill="currentColor"/>
        </svg>
        <div class="boot__msg">Establishing orbital link…</div>
      </div>`;
    document.body.appendChild(el);
    this._loader = el;
  }

  _hideLoader() {
    const el = this._loader;
    if (!el) return;
    this._loader = null;
    el.classList.add('is-hidden');
    setTimeout(() => el.remove(), 600);
  }
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const router = new Router();