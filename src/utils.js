// @ts-check
/**
 * Utility helpers used across OrbitOps.
 * @module utils
 */

'use strict';

/**
 * Clamp `n` between `min` and `max`.
 * @param {number} n @param {number} min @param {number} max @returns {number}
 */
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * Linear interpolation.
 * @param {number} a @param {number} b @param {number} t @returns {number}
 */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Map `x` from [a,b] to [c,d].
 * @param {number} x @param {number} a @param {number} b @param {number} c @param {number} d @returns {number}
 */
export const remap = (x, a, b, c, d) => c + ((x - a) * (d - c)) / (b - a);

/**
 * Format a number with locale separators and fixed decimals.
 * @param {number} n @param {number} [decimals=0] @returns {string}
 */
export const formatNumber = (n, decimals = 0) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * Format milliseconds as MM:SS or HH:MM:SS.
 * @param {number} ms @returns {string}
 */
export const formatDuration = (ms) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Tiny event emitter. */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this._listeners = new Map();
  }
  /**
   * @param {string} event
   * @param {(payload: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(event, fn) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }
  /**
   * @param {string} event
   * @param {(payload: any) => void} fn
   */
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }
  /**
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('listener error', event, e);
      }
    });
  }
  /**
   * @param {string} event
   * @param {(payload: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  once(event, fn) {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }
}

/**
 * Debounce a function.
 * @param {(...args: any[]) => void} fn @param {number} wait @returns {(...args: any[]) => void}
 */
export const debounce = (fn, wait) => {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

/**
 * Throttle a function to once per `wait` ms (trailing edge).
 * @param {(...args: any[]) => void} fn @param {number} wait @returns {(...args: any[]) => void}
 */
export const throttle = (fn, wait) => {
  let last = 0;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let pending;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
};

/**
 * Generate a unique-ish ID.
 * @returns {string}
 */
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/**
 * Deep clone JSON-safe values.
 * @template T @param {T} x @returns {T}
 */
export const deepClone = (x) => JSON.parse(JSON.stringify(x));

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Convert degrees to radians.
 * @param {number} d @returns {number}
 */
export const degToRad = (d) => (d * Math.PI) / 180;

/**
 * Convert radians to degrees.
 * @param {number} r @returns {number}
 */
export const radToDeg = (r) => (r * 180) / Math.PI;

/**
 * Wait until condition is true, polling every `interval` ms up to `timeout` ms.
 * @param {() => boolean} condition
 * @param {{interval?: number, timeout?: number}} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitFor(condition, { interval = 100, timeout = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return true;
    await sleep(interval);
  }
  return false;
}

/**
 * Format a number as a percentage with the % suffix.
 * @param {number} n @param {number} [decimals=0] @returns {string}
 */
export const pct = (n, decimals = 0) => `${(n * 100).toFixed(decimals)}%`;

/**
 * Format a number as a signed percentage.
 * @param {number} n @param {number} [decimals=0] @returns {string}
 */
export const signedPct = (n, decimals = 0) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(decimals)}%`;
