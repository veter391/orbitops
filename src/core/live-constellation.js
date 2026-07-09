// @ts-check
/**
 * Real constellation loader.
 *
 * Fetches live TLEs from CelesTrak (real Starlink / OneWeb / etc.), with a
 * three-layer strategy so the cockpit always has real orbital data to show:
 *
 *   1. localStorage cache (< 2h old) — CelesTrak updates on a ~2h cycle and
 *      asks callers not to re-download a group more often than that.
 *   2. Live CelesTrak fetch (browser-callable, CORS-enabled, no key).
 *   3. A bundled snapshot committed under /public/data — so the app still
 *      shows a real constellation offline or if CelesTrak is unreachable.
 *
 * These are real catalogued objects. What we do NOT get from any free source
 * is per-satellite health telemetry — that stays simulated and is labelled as
 * such in the UI. See core/sgp4.js for the propagation.
 *
 * @module core/live-constellation
 */

'use strict';

import { parseTle, makeSat } from './sgp4.js';
import { parseOmm, isOmm } from './omm.js';

/**
 * Parse a catalog feed body into TLE records, accepting either raw TLE or CCSDS
 * OMM (JSON / KVN — the modern standard CelesTrak and Space-Track also serve).
 * @param {string} text
 * @returns {Array<{name: string, line1: string, line2: string, noradId: number}>}
 */
function parseCatalog(text) {
  return isOmm(text) ? parseOmm(text) : parseTle(text);
}

/** A feed body is usable if it looks like TLE (`\n1 `) or is recognizable OMM. @param {string} text */
function looksLikeCatalog(text) {
  return text.includes('\n1 ') || isOmm(text);
}

/** @param {string} g */
const GROUP_URL = (g) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;
/** @param {string} g */
const SNAPSHOT_URL = (g) => `/public/data/${g}.tle`;
/** @param {string} g */
const CACHE_KEY = (g) => `orbitops:tle:${g}`;
const TTL_MS = 2 * 60 * 60 * 1000; // 2h — CelesTrak's own refresh cadence

/** localStorage key for the Data-Sources setting (Settings §02). */
const SOURCES_KEY = 'orbitops:settings:sources';

/**
 * The operator's configured feed preference: whether the bundled CelesTrak feed
 * is enabled, and an optional custom TLE endpoint (their own Space-Track proxy /
 * any TLE URL). Vendor-neutral multi-source ingestion — the app is not locked to
 * a single provider. @returns {{celestrak: boolean, customTleUrl: string}}
 */
function getSources() {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        celestrak: p.celestrak !== false,
        customTleUrl: typeof p.customTleUrl === 'string' ? p.customTleUrl.trim() : '',
      };
    }
  } catch {
    /* localStorage unavailable — default to the free feed */
  }
  return { celestrak: true, customTleUrl: '' };
}

/**
 * Resolve the operator's custom feed URL for a group. `{GROUP}` is substituted
 * (so one template can serve every group); otherwise the URL is used as-is (a
 * single feed for the whole fleet). Only http(s) is honoured. @param {string} url @param {string} group */
function resolveCustomUrl(url, group) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  return url.includes('{GROUP}') ? url.replace(/\{GROUP\}/g, encodeURIComponent(group)) : url;
}

/** @param {string} key @returns {string|null} cached TLE text within TTL, else null */
function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, text } = JSON.parse(raw);
      if (text && Date.now() - t < TTL_MS) return text;
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}
/** @param {string} key @param {string} text */
function writeCache(key, text) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), text }));
  } catch {
    /* quota — skip caching, still use the data */
  }
}

/** @param {string} group @returns {Promise<{text: string, source: string}>} */
async function loadGroupText(group) {
  const { celestrak, customTleUrl } = getSources();
  const customUrl = resolveCustomUrl(customTleUrl, group);

  // 0. Operator's own feed (Space-Track proxy / any TLE endpoint) takes priority
  //    when configured — vendor-neutral, no dependence on a single provider.
  if (customUrl) {
    // A custom-feed cache hit still reports 'custom' (the provider), not the
    // generic 'cache', so the UI keeps telling the operator it's their own feed.
    const cached = readCache(`orbitops:tle:custom:${customUrl}`);
    if (cached) return { text: cached, source: 'custom' };
    try {
      const res = await fetch(customUrl, { mode: 'cors' });
      if (res.ok) {
        const text = await res.text();
        if (looksLikeCatalog(text)) {
          writeCache(`orbitops:tle:custom:${customUrl}`, text);
          return { text, source: 'custom' };
        }
      }
    } catch {
      /* operator feed unreachable — fall through to CelesTrak / snapshot */
    }
  }

  // 1-2. Bundled CelesTrak feed (cache, then live) — unless the operator disabled it.
  if (celestrak) {
    const cached = readCache(CACHE_KEY(group));
    if (cached) return { text: cached, source: 'cache' };
    try {
      const res = await fetch(GROUP_URL(group), { mode: 'cors' });
      if (res.ok) {
        const text = await res.text();
        if (looksLikeCatalog(text)) {
          writeCache(CACHE_KEY(group), text);
          return { text, source: 'live' };
        }
      }
    } catch {
      /* network/CORS failure — fall through to bundled snapshot */
    }
  }

  // 3. bundled snapshot — always available so the app shows a real constellation.
  const res = await fetch(SNAPSHOT_URL(group));
  const text = await res.text();
  return { text, source: 'snapshot' };
}

/**
 * Evenly sample `n` items across `arr` (keeps a representative spread, not just the head).
 * @template T @param {T[]} arr @param {number} n @returns {T[]}
 */
function sample(arr, n) {
  if (arr.length <= n) return arr;
  /** @type {T[]} */
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/**
 * Load one or more CelesTrak groups into propagation-ready satellites.
 * @param {string[]} groups
 * @param {{max?: number}} [opts] - cap the number rendered (perf); the real
 *   total is still reported so the UI can state "N of M shown".
 * @returns {Promise<{sats: SatObject[], total: number, source: string, byGroup: Record<string, number>}>}
 */
export async function loadConstellation(groups = ['starlink', 'oneweb'], { max = 2200 } = {}) {
  /** @type {SatObject[]} */
  const all = [];
  /** @type {Record<string, number>} */
  const byGroup = {};
  // Report the least-fresh source across groups, so the UI never claims a fresh
  // feed when any group actually fell back to the bundled snapshot. `custom` and
  // `live` are both freshest (0); `custom` is preferred as the label when present.
  /** @type {Record<string, number>} */
  const SEVERITY = { custom: 0, live: 0, cache: 1, snapshot: 2 };
  /** @type {string|null} */
  let source = null;

  for (const g of groups) {
    const { text, source: s } = await loadGroupText(g);
    if (source === null || SEVERITY[s] > SEVERITY[source]) source = s;
    const recs = parseCatalog(text);
    byGroup[g] = recs.length;
    for (const r of recs) {
      const sat = makeSat(r);
      sat.group = g;
      all.push(sat);
    }
  }

  return { sats: sample(all, max), total: all.length, source: source ?? 'snapshot', byGroup };
}
