// @ts-check
/**
 * OrbitOps — main entry.
 *
 * Routes:
 *   /          — cinematic home
 *   /cockpit   — full-screen mission control
 *   /agent     — AI agent deep-dive
 *   /dashboard — live constellation health
 *   /tools     — interactive mini-tools
 *   /pricing   — enterprise pricing
 *   /docs      — engineering documentation
 */

'use strict';

import { router } from './router.js';
import { info } from './ui/toast.js';
import { mountCursorSat } from './ui/cursor-sat.js';
import { isAppMode, hiddenInApp, resolveInitialRoute } from './core/app-config.js';
import { esc } from './utils.js';

const boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootMsg');
const bootSub = document.getElementById('bootSub');
const app = document.getElementById('app');
const topNav = document.getElementById('topNav');
if (topNav) topNav.classList.add('top-nav');

const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(2)}s`;

/** @param {string} msg */
function setBoot(msg) {
  if (bootMsg) bootMsg.textContent = msg;
  if (bootSub) bootSub.textContent = elapsed();
}

function hideBoot() {
  if (!boot) return;
  boot.classList.add('is-hidden');
  setTimeout(() => boot.remove(), 600);
}

/** @param {string} title @param {string} detail @param {any} [error] */
function fatalBoot(title, detail, error) {
  console.error('[OrbitOps] boot failed:', error);
  if (!boot) return;
  boot.innerHTML = `
    <div class="boot__inner">
      <svg class="boot__mark" style="color: var(--alert); animation: none;" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>
        <path d="M22 22 L42 42 M42 22 L22 42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div class="boot__title" style="color: var(--alert);">${esc(title)}</div>
      <div class="boot__msg">${esc(detail)}</div>
      ${error ? `<pre class="boot__error">${esc(String(error.stack || error.message || error))}</pre>` : ''}
      <button class="boot__btn" id="bootContinue">Continue without demo →</button>
    </div>
  `;
  document.getElementById('bootContinue')?.addEventListener('click', () => {
    boot.classList.add('is-hidden');
    setTimeout(() => boot.remove(), 400);
  });
}

/* ============================================================
   Header tab icons — 16×16 hairline SVG paths, stroke-only,
   inherit currentColor. One glyph per destination.
   ============================================================ */
const TAB_ICONS = {
  // globe grid — orbital view
  cockpit:
    '<circle cx="8" cy="8" r="5.5"/><ellipse cx="8" cy="8" rx="2.6" ry="5.5"/><path d="M2.7 8h10.6M3.6 5h8.8M3.6 11h8.8"/>',
  // node chain — reasoning graph
  agent:
    '<circle cx="3.2" cy="12" r="1.6"/><circle cx="8" cy="4.6" r="1.6"/><circle cx="12.8" cy="11.2" r="1.6"/><path d="M4.1 10.7l3-4.5M9 5.9l3 3.9"/>',
  // gauge arc + needle
  dashboard:
    '<path d="M2.8 11.6a5.6 5.6 0 1 1 10.4 0"/><path d="M8 11.4l2.6-3.6"/><circle cx="8" cy="11.6" r="0.9"/>',
  // wrench inside an orbit sweep
  tools:
    '<ellipse cx="8" cy="8.4" rx="6.6" ry="2.4" transform="rotate(-18 8 8.4)" opacity="0.55"/><path d="M4.8 11.2l4.4-4.4"/><path d="M9 4.4a2.3 2.3 0 1 1 2.6 2.6L9.2 6.8 9 4.4z"/>',
  // price tag
  pricing:
    '<path d="M8.6 2.5h4.9v4.9L7.4 13.5 2.5 8.6 8.6 2.5z"/><circle cx="10.9" cy="5.1" r="1"/>',
  // file with folded corner
  docs:
    '<path d="M4 2.5h5.5L12 5v8.5H4z"/><path d="M9.5 2.5V5H12"/><path d="M6 8h4M6 10.5h4"/>',
  // gear — settings (toothed cog, not a sun)
  settings:
    '<circle cx="8" cy="8" r="2.3"/><path d="M8 1.4l.75 1.55a5.7 5.7 0 0 1 1.5.62l1.65-.5.95 1.65-1.2 1.2a5.7 5.7 0 0 1 0 1.62l1.2 1.2-.95 1.65-1.65-.5a5.7 5.7 0 0 1-1.5.62L8 14.6l-.75-1.55a5.7 5.7 0 0 1-1.5-.62l-1.65.5-.95-1.65 1.2-1.2a5.7 5.7 0 0 1 0-1.62l-1.2-1.2.95-1.65 1.65.5a5.7 5.7 0 0 1 1.5-.62L8 1.4z"/>',
};

/** Per-route document title + meta description. Hash routing means crawlers see
   one URL, so this is for the browser tab, history entries and shared/bookmarked
   links rather than deep SEO — honest, concrete copy, no marketing inflation.
   @type {Record<string, [string, string]>} */
const ROUTE_META = {
  '/': [
    'OrbitOps — Mission control for the real sky',
    'Open-source mission control for satellite operators: the live CelesTrak catalogue propagated with SGP4, an accountable AI co-pilot, and a human in every loop.',
  ],
  '/cockpit': [
    'Cockpit — OrbitOps',
    'A live 3D constellation from the real CelesTrak catalogue, propagated with SGP4 in your browser. Pick any object for its position, velocity and next pass.',
  ],
  '/agent': [
    'AI Agent — OrbitOps',
    'An accountable AI co-pilot that drafts maneuvers and anomaly responses, shows its full reasoning, and never acts until a human approves.',
  ],
  '/dashboard': [
    'Dashboard — OrbitOps',
    'Constellation analytics over the real catalogue: altitude bands, orbital shells, inclination families and launch history — computed, never faked.',
  ],
  '/tools': [
    'Flight tools — OrbitOps',
    'Orbit calculator, conjunction check, burn planner and pass predictor — real client-side math with honestly labelled limits.',
  ],
  '/pricing': [
    'Pricing — OrbitOps',
    'Free forever to self-host, MIT-licensed. A managed cloud is planned. Support the work through GitHub Sponsors.',
  ],
  '/docs': [
    'Docs — OrbitOps',
    'How OrbitOps works: install, data sources and accuracy, the orbit engine, the AI agent, and the audit log.',
  ],
  '/settings': [
    'Settings — OrbitOps',
    'Bring your own model key, choose data sources and compute profiles, and export your audit data — all kept locally in your browser.',
  ],
};

/** Set the tab title + meta description for a route (docs sub-paths share /docs). @param {string} path */
function setRouteMeta(path) {
  const key = path.startsWith('/docs') ? '/docs' : path;
  const [title, desc] = ROUTE_META[key] || ROUTE_META['/'];
  document.title = title;
  const m = document.querySelector('meta[name="description"]');
  if (m && desc) m.setAttribute('content', desc);
}

/**
 * One command-bar tab: index · icon · label · shimmer overlay.
 * @param {string} route @param {string} idx @param {string} label @param {string} icon
 */
function navTab(route, idx, label, icon) {
  // idx kept in the signature for call-site stability but no longer rendered —
  // owner: the 01/02… numbers added clutter and overlapped on magnify.
  void idx;
  return `<a href="${route}" data-route="${route}">
    <svg class="top-nav__tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
    <span class="top-nav__tab-label">${label}</span>
    <span class="top-nav__tab-shine" aria-hidden="true"></span>
  </a>`;
}

/* ============================================================
   Dock magnification (B1) — macOS-fisheye over the tab list.
   pointermove sets --dock-s per tab from horizontal distance to
   the pointer: s = 1 + 0.22 · max(0, 1 − (d/125)²), so the
   hovered tab reaches ~1.22 and a neighbour ~100px away lands
   near 1.08. rAF-throttled; vars removed on pointerleave so CSS
   transitions ease everything back. Desktop + fine pointer +
   motion-OK only — reduced motion falls back to the existing
   color/bracket hover.
   ============================================================ */
/** @param {HTMLElement} navLinks */
function initDockMagnify(navLinks) {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const RADIUS = 125; // px — influence falls to zero here
  const MAX_GROW = 0.22; // hovered tab peaks at scale 1.22
  let rafId = 0;
  let pointerX = -1;

  const tabs = () =>
    /** @type {HTMLElement[]} */ (Array.from(navLinks.querySelectorAll('a[data-route]:not(.top-nav__menu-cta)')));

  const apply = () => {
    rafId = 0;
    // Two passes: read ALL geometry first, then write ALL styles. A --dock-s
    // write drives a scale transform, which changes getBoundingClientRect, so
    // interleaving read/write per tab would force a synchronous reflow each
    // iteration. Batching read-then-write avoids the layout thrash.
    const els = tabs();
    const centers = els.map((el) => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; });
    els.forEach((el, i) => {
      const d = Math.abs(pointerX - centers[i]);
      const falloff = Math.max(0, 1 - (d / RADIUS) * (d / RADIUS));
      el.style.setProperty('--dock-s', (1 + MAX_GROW * falloff).toFixed(3));
    });
  };

  navLinks.addEventListener(
    'pointermove',
    (e) => {
      if (reducedMotion.matches || !finePointer.matches || window.innerWidth <= 880) return;
      pointerX = e.clientX;
      if (!rafId) rafId = requestAnimationFrame(apply);
    },
    { passive: true },
  );

  navLinks.addEventListener('pointerleave', () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
    tabs().forEach((el) => el.style.removeProperty('--dock-s'));
  });
}

/* ============================================================
   TLE cache stats (B2/B3) — read-only over the localStorage
   cache live-constellation.js maintains. Honest: returns null
   when nothing is cached, and the chips hide/say SNAPSHOT.
   ============================================================ */
function readTleCacheStats(groups = ['starlink', 'oneweb']) {
  let count = 0;
  let oldest = Infinity;
  try {
    for (const g of groups) {
      const raw = localStorage.getItem(`orbitops:tle:${g}`);
      if (!raw) continue;
      const { t, text } = JSON.parse(raw) || {};
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (line.startsWith('1 ')) count++;
      }
      if (Number.isFinite(t)) oldest = Math.min(oldest, t);
    }
  } catch {
    return null; // localStorage unavailable / corrupt entry — show nothing
  }
  if (!count) return null;
  return { count, ageMs: Number.isFinite(oldest) ? Date.now() - oldest : null };
}

/** Refresh header + footer data chips. Called on route change only. */
function updateDataChips() {
  const stats = readTleCacheStats();
  const fmt = stats ? stats.count.toLocaleString('en-US') : '';
  const navChip = document.getElementById('navTracked');
  const footCatalog = document.getElementById('footCatalog');
  const footFresh = document.getElementById('footFresh');
  if (navChip) {
    navChip.hidden = !stats;
    if (stats) navChip.textContent = `${fmt} TRACKED`;
  }
  if (footCatalog) {
    footCatalog.hidden = !stats;
    if (stats) footCatalog.textContent = `CATALOG ${fmt}`;
  }
  if (footFresh) {
    footFresh.textContent =
      stats && stats.ageMs !== null
        ? `TLE CACHE ${(stats.ageMs / 3600000).toFixed(1)}H`
        : 'SNAPSHOT';
  }
}

async function main() {
  try {
    // Boot stays visible through the real first-route mount below, then fades.
    // No artificial delay — the message reflects actual startup, nothing faked.
    setBoot('Establishing orbital link…');

    // Top nav — OS command strip: [instrument cluster] [indexed tabs] [actions] + data rail
    if (topNav) {
      topNav.innerHTML = `
        <div class="top-nav__left">
          <div class="top-nav__cluster">
            <a href="/" data-route="/" class="top-nav__brand top-nav__seg">
              <svg class="top-nav__brand-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
                <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55" transform="rotate(60 16 16)"/>
                <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55" transform="rotate(-60 16 16)"/>
                <circle cx="16" cy="16" r="3.5" fill="currentColor"/>
              </svg>
              <span class="top-nav__brand-text">ORBIT OPS</span>
            </a>
            <span class="top-nav__seg top-nav__seg--clock">
              <span class="top-nav__clock" id="navClock">--:--:-- UTC</span>
            </span>
            <span class="top-nav__seg top-nav__seg--sys">
              <span class="top-nav__sys"><span class="top-nav__sys-dot" aria-hidden="true"></span>SYS NOMINAL</span>
            </span>
          </div>
        </div>
        <nav class="top-nav__links" aria-label="Primary">
          ${navTab('/cockpit', '01', 'Cockpit', TAB_ICONS.cockpit)}
          ${navTab('/agent', '02', 'Agent', TAB_ICONS.agent)}
          ${navTab('/dashboard', '03', 'Dashboard', TAB_ICONS.dashboard)}
          ${navTab('/tools', '04', 'Tools', TAB_ICONS.tools)}
          ${navTab('/pricing', '05', 'Pricing', TAB_ICONS.pricing)}
          ${navTab('/docs', '06', 'Docs', TAB_ICONS.docs)}
          ${navTab('/settings', '07', 'Settings', TAB_ICONS.settings)}
          <a href="/pricing" data-route="/pricing" class="top-nav__menu-cta">Request pilot</a>
        </nav>
        <div class="top-nav__right">
          <a class="top-nav__icon" href="https://github.com/veter391/orbitops" target="_blank" rel="noreferrer" title="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.3-.1-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.3a11.5 11.5 0 0 1 6 0c2.3-1.6 3.3-1.3 3.3-1.3.7 1.7.2 3 .1 3.3.8.9 1.3 2 1.3 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
          </a>
          <a class="btn btn--primary btn--sm top-nav__cta-btn" href="/pricing" data-route="/pricing">Request pilot</a>
          <button class="top-nav__burger" id="topNavBurger" aria-label="Open menu" aria-expanded="false" type="button">
            <span></span><span></span><span></span>
          </button>
        </div>
        <span class="top-nav__rail" aria-hidden="true"></span>
      `;

      // APP_MODE nav rules (see core/app-config.js). Site mode (default, the
      // public demo) is unchanged and now shows the always-visible Settings
      // tab. App mode (self-host / ?app) additionally hides marketing routes:
      // the Pricing tab and every "Request pilot" CTA that points at /pricing.
      // Settings stays visible in both modes.
      if (isAppMode()) {
        // Only primary nav tabs — never the brand logo (which also routes to /
        // but is the app's home affordance in both modes).
        topNav
          .querySelectorAll('.top-nav__links a[data-route]')
          .forEach((el) => {
            const route = el.getAttribute('data-route');
            if (route && hiddenInApp(route)) /** @type {HTMLElement} */ (el).hidden = true;
          });
        topNav.querySelectorAll('.top-nav__menu-cta, .top-nav__cta-btn').forEach((el) => {
          /** @type {HTMLElement} */ (el).hidden = true;
        });
      }

      // Dock magnification over the tab list (B1)
      const navLinksEl = /** @type {HTMLElement|null} */ (topNav.querySelector('.top-nav__links'));
      if (navLinksEl) initDockMagnify(navLinksEl);

      // Wire burger
      const burger = topNav.querySelector('#topNavBurger');
      if (burger) {
        burger.addEventListener('click', () => {
          const open = !topNav.classList.contains('is-mobile-open');
          topNav.classList.toggle('is-mobile-open', open);
          burger.setAttribute('aria-expanded', String(open));
        });
      }

      // Close mobile menu on route change
      window.addEventListener('hashchange', () => {
        if (topNav) topNav.classList.remove('is-mobile-open');
        if (burger) burger.setAttribute('aria-expanded', 'false');
      });

      // chrome-v2 stylesheet — appended last so it overrides every other sheet
      if (!document.querySelector('link[data-chrome-v2]')) {
        const chromeV2 = document.createElement('link');
        chromeV2.rel = 'stylesheet';
        chromeV2.href = '/src/styles/chrome-v2.css';
        chromeV2.setAttribute('data-chrome-v2', '');
        document.head.appendChild(chromeV2);
      }

      // Live UTC clocks (command bar + console footer) — one guarded interval
      const tickUtcClocks = () => {
        const utc = `${new Date().toISOString().slice(11, 19)} UTC`;
        const navClock = document.getElementById('navClock');
        const footClock = document.getElementById('footClock');
        if (navClock) navClock.textContent = utc;
        if (footClock) footClock.textContent = utc;
      };
      if (window.__orbitopsUtcClock) clearInterval(window.__orbitopsUtcClock);
      window.__orbitopsUtcClock = setInterval(tickUtcClocks, 1000);
      tickUtcClocks();

      // Data rail — 1px track under the bar; an ice tick slides to sit under
      // the ACTIVE tab. CSS anchor positioning is not cross-browser yet, so
      // the tick is driven by two CSS vars measured from the active link,
      // recomputed on route change and (rAF-guarded) on resize + font load.
      const positionRail = () => {
        const active = topNav.querySelector('.top-nav__links a.is-active:not(.top-nav__menu-cta)');
        if (!active || window.innerWidth <= 880) {
          topNav.style.setProperty('--rail-w', '0px');
          return;
        }
        const navBox = topNav.getBoundingClientRect();
        const tabBox = active.getBoundingClientRect();
        topNav.style.setProperty('--rail-x', `${Math.round(tabBox.left - navBox.left)}px`);
        topNav.style.setProperty('--rail-w', `${Math.round(tabBox.width)}px`);
      };
      let railRaf = 0;
      window.addEventListener('resize', () => {
        cancelAnimationFrame(railRaf);
        railRaf = requestAnimationFrame(positionRail);
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionRail);

      // Mirror the router's active route onto command-bar tabs. router.init()
      // is called without a nav element, so its own is-active pass never runs;
      // listen to the router's change event instead of re-implementing routing.
      // Sub-routes (e.g. /docs/terms) keep their parent tab active.
      router.on('change', (path) => {
        topNav.querySelectorAll('a[data-route]').forEach((el) => {
          const route = el.getAttribute('data-route');
          el.classList.toggle('is-active', route === path || (route !== '/' && path.startsWith(route + '/')));
        });
        positionRail();
      });
    }

    // Register routes — each page module is imported lazily on first navigation
    // so the initial load parses only the entry it needs (home + chrome), not
    // all eight page modules up front. import() results are module-cached, so
    // repeat visits reuse the already-parsed module with no refetch.
    /** @type {Record<string, () => Promise<any>>} */
    const pageLoaders = {
      '/': () => import('./pages/home.js'),
      '/cockpit': () => import('./pages/cockpit.js'),
      '/agent': () => import('./pages/agent.js'),
      '/dashboard': () => import('./pages/dashboard.js'),
      '/tools': () => import('./pages/tools.js'),
      '/pricing': () => import('./pages/pricing.js'),
      '/docs': () => import('./pages/docs.js'),
      '/settings': () => import('./pages/settings.js'),
    };
    /** @param {() => Promise<any>} loader */
    const lazy = (loader) => (/** @type {HTMLElement} */ mountEl) => loader().then((/** @type {any} */ m) => m.mount(mountEl));
    for (const [path, loader] of Object.entries(pageLoaders)) {
      router.register(path, lazy(loader));
    }
    // Legal deep links (footer LEGAL column) — same docs page; docs.js reads
    // the sub-path from the hash and opens the matching sidebar entry.
    router.register('/docs/terms', lazy(pageLoaders['/docs']));
    router.register('/docs/privacy', lazy(pageLoaders['/docs']));
    router.register('/docs/data', lazy(pageLoaders['/docs']));

    // Prewarm-on-intent — hovering a tab imports that page's module (and, for
    // 3D routes, three.js) before the click, so navigation feels instant. The
    // module cache makes each route warm at most once; failures un-mark so a
    // later real navigation still surfaces the error normally.
    const THREE_ROUTES = new Set(['/cockpit', '/tools']); // home already loads three
    /** @type {Set<string>} */
    const warmed = new Set();
    /** @param {string} path */
    const prewarm = (path) => {
      const loader = pageLoaders[path];
      if (!loader || warmed.has(path)) return;
      warmed.add(path);
      Promise.all([loader(), THREE_ROUTES.has(path) ? import('three') : null]).catch(() => {
        warmed.delete(path);
      });
    };
    if (topNav) {
      topNav.addEventListener(
        'pointerover',
        (e) => {
          const link = /** @type {HTMLElement|null} */ (e.target)?.closest('a[data-route]');
          const route = link?.getAttribute('data-route');
          if (route) prewarm(route);
        },
        { passive: true },
      );
    }

    // Data chips (B2/B3) + global cursor satellite (B4) — one route hook.
    // The satellite is global on every route EXCEPT home: home.js mounts its
    // own page-local instance (not ours to edit), so we yield there and the
    // window.__orbitopsCursorSat flag inside mountCursorSat() guards doubles.
    const cursorSatAllowed =
      window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /** @type {{unmount: () => void}|null} */
    let cursorSat = null;
    router.on('change', (path) => {
      setRouteMeta(path);
      updateDataChips();
      if (!cursorSatAllowed) return;
      if (path === '/') {
        if (cursorSat) {
          cursorSat.unmount();
          cursorSat = null;
        }
      } else if (!cursorSat && !window.__orbitopsCursorSat) {
        cursorSat = mountCursorSat();
      }
    });

    // APP_MODE routing (see core/app-config.js): in app mode a request for the
    // empty root or a marketing route resolves to /dashboard instead of /. Wire
    // resolveInitialRoute as the router guard so this holds on EVERY navigation
    // (boot, deep link, and mid-session brand-logo clicks) — not just first
    // paint. Site mode (default) is untouched: the guard returns the requested
    // path verbatim.
    router.guard = resolveInitialRoute;

    if (app) router.init(app);

    // Hide boot
    hideBoot();

    // Year in footer
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // Welcome toast — shown only once per session
    if (!sessionStorage.getItem('orbitops-welcomed')) {
      sessionStorage.setItem('orbitops-welcomed', '1');
      setTimeout(() => {
        info('Use ↑↓ keys or scroll to navigate · drag in cockpit to orbit', {
          title: 'OrbitOps',
          durationMs: 5000,
        });
      }, 1500);
    }

    // Global error handlers
    window.addEventListener('error', (e) => console.error('[OrbitOps] error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => console.error('[OrbitOps] unhandled', e.reason));
  } catch (err) {
    const emsg = err instanceof Error ? err.message : 'unknown error';
    fatalBoot('Boot failed', elapsed() + ' · ' + emsg, err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}