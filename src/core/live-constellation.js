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

/** @param {string} g */
const GROUP_URL = (g) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;
/** @param {string} g */
const SNAPSHOT_URL = (g) => `/public/data/${g}.tle`;
/** @param {string} g */
const CACHE_KEY = (g) => `orbitops:tle:${g}`;
const TTL_MS = 2 * 60 * 60 * 1000; // 2h — CelesTrak's own refresh cadence

/** @param {string} group @returns {Promise<{text: string, source: string}>} */
async function loadGroupText(group) {
  // 1. fresh localStorage cache
  try {
    const raw = localStorage.getItem(CACHE_KEY(group));
    if (raw) {
      const { t, text } = JSON.parse(raw);
      if (text && Date.now() - t < TTL_MS) return { text, source: 'cache' };
    }
  } catch {
    /* localStorage unavailable — fall through */
  }

  // 2. live CelesTrak
  try {
    const res = await fetch(GROUP_URL(group), { mode: 'cors' });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('\n1 ')) {
        try {
          localStorage.setItem(CACHE_KEY(group), JSON.stringify({ t: Date.now(), text }));
        } catch {
          /* quota — skip caching, still use the data */
        }
        return { text, source: 'live' };
      }
    }
  } catch {
    /* network/CORS failure — fall through to bundled snapshot */
  }

  // 3. bundled snapshot
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
  // Report the least-fresh source across groups, so the UI never claims "live"
  // when any group actually fell back to the bundled snapshot.
  /** @type {Record<string, number>} */
  const SEVERITY = { live: 0, cache: 1, snapshot: 2 };
  let source = 'live';

  for (const g of groups) {
    const { text, source: s } = await loadGroupText(g);
    if (SEVERITY[s] > SEVERITY[source]) source = s;
    const recs = parseTle(text);
    byGroup[g] = recs.length;
    for (const r of recs) {
      const sat = makeSat(r);
      sat.group = g;
      all.push(sat);
    }
  }

  return { sats: sample(all, max), total: all.length, source, byGroup };
}
