// @ts-check
/**
 * Per-route SEO metadata — the single source of truth, shared by two consumers:
 *
 *   1. `src/main.js` (browser) — updates `document.title` + meta description on
 *      client-side navigation, so the tab title and history entries are right.
 *   2. `worker.js` (edge) — rewrites the served `index.html`'s title,
 *      description, canonical and Open Graph tags per request path, so crawlers
 *      and social scrapers (which don't run the SPA's JavaScript) see
 *      route-specific metadata instead of the home page's on every URL.
 *
 * Keep this module dependency-free and side-effect-free: it must run in both
 * the browser and the Workers runtime.
 *
 * @module core/route-meta
 */

'use strict';

/**
 * The canonical origin for absolute URLs (canonical / og:url). Deliberately a
 * constant rather than the request host: the workers.dev fallback host serves
 * the same content, and its pages must consolidate to the primary domain.
 */
export const CANONICAL_ORIGIN = 'https://orbitops.shypot.com';

/**
 * Route → [title, description]. Descriptions are honest, concrete copy — no
 * marketing inflation (see internal brand rules: calm, technical, accountable).
 * @type {Record<string, [string, string]>}
 */
export const ROUTE_META = {
  '/': [
    'OrbitOps — Mission control for the real sky',
    'OrbitOps is open-source mission control for satellite constellation operators — the live CelesTrak catalog propagated with SGP4 in your browser, an accountable AI co-pilot with a human in every loop, and a hash-chained audit log. MIT-licensed, zero install.',
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
  '/docs/going-live': [
    'Going live · connect a backend — OrbitOps docs',
    'How to connect the OrbitOps browser app to a live backend: run the Node service, set the URL and key in Settings, and watch the panels switch to real data.',
  ],
  '/docs/terms': [
    'Terms of Use — OrbitOps docs',
    'The terms under which the OrbitOps demo and open-source software are provided.',
  ],
  '/docs/privacy': [
    'Privacy & GDPR — OrbitOps docs',
    'What OrbitOps stores and what it never collects: no accounts, no analytics, no tracking. Keys and settings stay in your browser.',
  ],
  '/docs/data': [
    'Data policy — OrbitOps docs',
    'Where OrbitOps data comes from (CelesTrak, public catalogs), how fresh it is, and what is simulated with a label.',
  ],
  '/settings': [
    'Settings — OrbitOps',
    'Bring your own model key, choose data sources and compute profiles, and export your audit data — all kept locally in your browser.',
  ],
};

/**
 * Normalize a path for lookup: strip a single trailing slash (except root).
 * @param {string} path
 */
function cleanPath(path) {
  return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * True when `path` is a registered route with its own metadata. Crucially,
 * unregistered paths are NOT known — including unknown `/docs/*` such as
 * `/docs/quickstart`, which is a within-page sidebar switch, not a clean-URL
 * route: the router renders those as the home view, so they must resolve to
 * home metadata and a home canonical, never a self-referential URL the router
 * can't actually serve (that would mint an unbounded soft-404 / duplicate-URL
 * space for crawlers). Shared by the browser and the edge worker so both agree
 * on exactly which paths get route-specific SEO.
 * @param {string} path
 */
export function isKnownRoute(path) {
  return Object.prototype.hasOwnProperty.call(ROUTE_META, cleanPath(path));
}

/**
 * Resolve the metadata for a path: exact match, else home. No prefix fallback —
 * an unregistered path renders the home view client-side, so its metadata and
 * canonical are home's, matching what actually renders.
 * @param {string} path
 * @returns {{ title: string, description: string, canonical: string }}
 */
export function resolveRouteMeta(path) {
  const clean = cleanPath(path);
  const known = isKnownRoute(clean);
  const entry = known ? ROUTE_META[clean] : ROUTE_META['/'];
  const canonicalPath = known ? clean : '/';
  return {
    title: entry[0],
    description: entry[1],
    canonical: `${CANONICAL_ORIGIN}${canonicalPath}`,
  };
}
