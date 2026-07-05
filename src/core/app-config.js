// @ts-check
/**
 * app-config.js — APP_MODE scaffold for the open-core packaging split.
 *
 * OrbitOps ships as ONE public MIT repository. That single repo serves two
 * audiences that see two different surfaces:
 *
 *   - SITE MODE (default, `APP_MODE = false`) — the public marketing demo you
 *     are looking at now: landing (`/`) and pricing (`/pricing`) plus every
 *     functional page, so a visitor can explore the whole thing. The Settings
 *     tab is *also* visible here on purpose — the owner wants Settings designed,
 *     reviewable, and reachable in the public demo.
 *
 *   - APP MODE (`isAppMode() === true`) — the self-hosted operator build. Boots
 *     straight to `/dashboard`, hides the marketing routes (home CTA, pricing),
 *     and surfaces `/settings` as a first-class tab. A self-hoster (or a curious
 *     visitor) opts in with `?app` in the URL or a persisted localStorage flag —
 *     no separate bundle required to try it.
 *
 * Packaging plan (design-time scaffolding — wired at the hosting phase)
 * --------------------------------------------------------------------
 * In a real OSS release the split is enforced by the build, not the browser:
 *
 *   - `package.json` gains a `"files"` whitelist that ships ONLY the app
 *     surface (`src/pages/dashboard.js`, `cockpit.js`, `agent.js`, `tools.js`,
 *     `docs.js`, `settings.js`, all of `src/core/**`, `src/ui/**`, styles) and
 *     EXCLUDES the marketing pages (`home.js`, `pricing.js`) and their assets.
 *   - The operator build sets `APP_MODE = true` at build time (env-substituted
 *     into this module, or a generated `app-config.build.js`), so the shipped
 *     bundle boots to `/dashboard` with marketing routes absent.
 *   - The public demo (this repo, deployed to the marketing domain) keeps
 *     `APP_MODE = false`; the `?app` / localStorage overrides let anyone preview
 *     the operator surface without a rebuild.
 *
 * Nothing here talks to a backend. It is pure, synchronous, client-only config.
 *
 * @module core/app-config
 */

'use strict';

/**
 * Compile-time default. `false` = public "site mode".
 *
 * In an operator OSS build this constant is flipped to `true` (see the
 * packaging plan above). Runtime overrides in {@link isAppMode} still win, so
 * flipping this only changes the *default* an untouched build boots into.
 *
 * @type {boolean}
 */
export const APP_MODE = false;

/** localStorage key persisting a runtime app-mode opt-in across reloads. */
const APP_MODE_KEY = 'orbitops:appMode';

/**
 * Marketing-only routes. Present in site mode; hidden (and never the boot
 * target) in app mode. Kept as a flat list so both the router bootstrap and
 * the nav builder can consult one source of truth.
 * @type {ReadonlyArray<string>}
 */
export const SITE_ONLY_ROUTES = Object.freeze(['/', '/pricing']);

/** The route an operator (app-mode) build boots into instead of `/`. */
export const APP_HOME_ROUTE = '/dashboard';

/**
 * Read the persisted app-mode flag from localStorage, tolerating private-mode
 * / disabled storage (returns null, never throws).
 * @returns {boolean|null} true/false if explicitly set, else null (unset).
 */
function storedAppMode() {
  try {
    const raw = localStorage.getItem(APP_MODE_KEY);
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect a `?app` (or `?app=1`) flag on the current URL. A bare `?app`,
 * `?app=1`, `?app=true` enables; `?app=0` / `?app=false` disables. Works with
 * the hash router: the query may live before the `#` or inside the hash
 * (e.g. `#/dashboard?app`), so both are scanned.
 * @returns {boolean|null} explicit true/false, or null when the flag is absent.
 */
function urlAppFlag() {
  try {
    /** @param {string|null} qs @returns {boolean|null} */
    const parse = (qs) => {
      if (!qs) return null;
      const params = new URLSearchParams(qs);
      if (!params.has('app')) return null;
      const v = params.get('app');
      if (v === null || v === '' || v === '1' || v === 'true') return true;
      if (v === '0' || v === 'false') return false;
      return true;
    };
    const search = parse(location.search.replace(/^\?/, ''));
    if (search !== null) return search;
    const hash = location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx !== -1) return parse(hash.slice(qIdx + 1));
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist an app-mode opt-in so it survives reloads. Passing a URL `?app` flag
 * also latches here (called once from the bootstrap) so the operator keeps app
 * mode after the query string is gone.
 * @param {boolean} on
 */
export function setAppMode(on) {
  try {
    localStorage.setItem(APP_MODE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable — the ?app flag still drives this session */
  }
}

/**
 * Resolve whether the app is running in operator (app) mode for THIS session.
 *
 * Precedence, highest first:
 *   1. `?app` URL flag (explicit true/false) — latched into storage as a
 *      side-effect so it persists past the query string.
 *   2. persisted localStorage opt-in.
 *   3. the compile-time {@link APP_MODE} default.
 *
 * @returns {boolean}
 */
export function isAppMode() {
  const fromUrl = urlAppFlag();
  if (fromUrl !== null) {
    setAppMode(fromUrl); // latch the URL choice so a reload keeps it
    return fromUrl;
  }
  const fromStore = storedAppMode();
  if (fromStore !== null) return fromStore;
  return APP_MODE;
}

/**
 * Should `path` be hidden in the current app-mode context?
 *
 * In app mode, marketing routes are hidden. In site mode nothing is hidden
 * (the public demo shows everything, including Settings). This is the single
 * predicate the nav builder and router bootstrap use to decide visibility.
 *
 * @param {string} path route path, e.g. '/pricing'
 * @returns {boolean} true when the route should be hidden from nav/boot.
 */
export function hiddenInApp(path) {
  return isAppMode() && SITE_ONLY_ROUTES.includes(path);
}

/**
 * The route the app should boot into given the current mode and the requested
 * initial path. In app mode a request for a marketing route (or the empty
 * root) is redirected to {@link APP_HOME_ROUTE}; otherwise the requested path
 * is honored.
 *
 * @param {string} [requested='/'] the path from the URL hash on load.
 * @returns {string}
 */
export function resolveInitialRoute(requested = '/') {
  if (!isAppMode()) return requested;
  if (!requested || requested === '/' || SITE_ONLY_ROUTES.includes(requested)) {
    return APP_HOME_ROUTE;
  }
  return requested;
}
