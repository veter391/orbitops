// @ts-check
/**
 * Audit log — append-only, hash-chained log of every operator action,
 * AI proposal, and system event.
 *
 * Each entry carries:
 *   - seq:        monotonic sequence number
 *   - ts:         timestamp (ms since epoch)
 *   - actor:      'user:<id>' | 'ai:<agent_id>' | 'system'
 *   - action:     verb describing what happened
 *   - payload:    arbitrary JSON-serialisable detail
 *   - prevHash:   hash of previous entry (or 0x0..0 for first)
 *   - hash:       SHA-256 of (prevHash || seq || ts || actor || action || JSON.stringify(payload))
 *
 * This is tamper-evident: any modification to history will break the hash chain.
 * Customers can export the log and verify offline.
 *
 * @module core/audit-log
 */

'use strict';

/**
 * @typedef {object} AuditEntry
 * @property {number} seq
 * @property {number} ts
 * @property {string} actor
 * @property {string} action
 * @property {Record<string, unknown>} payload
 * @property {string} prevHash
 * @property {string|null} hash
 */

/** Cheap hash function for browser environments where SubtleCrypto may not be available.
 *  Production: use SubtleCrypto.digest('SHA-256', ...) when available.
 *  @param {string} input
 *  @returns {Promise<string>}
 */
async function hash(input) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const bytes = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: simple hash (not cryptographically secure but deterministic)
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(8); // pad to 64 hex chars
}

export class AuditLog {
  constructor() {
    /** @type {AuditEntry[]} */
    this.entries = [];
    /** @type {Set<(e: AuditEntry) => void>} */
    this.subscribers = new Set();
    this.lastHash = '0'.repeat(64);
  }

  /**
   * @param {string} actor
   * @param {string} action
   * @param {Record<string, unknown>} [payload]
   * @returns {Promise<AuditEntry>}
   */
  async append(actor, action, payload = {}) {
    const seq = this.entries.length;
    const ts = Date.now();
    /** @type {AuditEntry} */
    const entry = {
      seq,
      ts,
      actor,
      action,
      payload,
      prevHash: this.lastHash,
      hash: null,
    };
    const input =
      entry.prevHash + seq + ts + actor + action + JSON.stringify(payload);
    entry.hash = await hash(input);
    this.lastHash = entry.hash;
    this.entries.push(entry);
    this._notify(entry);
    return entry;
  }

  /**
   * @param {string} actor
   * @param {string} action
   * @param {Record<string, unknown>} [payload]
   * @returns {Promise<AuditEntry>}
   */
  async appendSync(actor, action, payload = {}) {
    // For testing: pre-compute hash synchronously with fallback
    return this.append(actor, action, payload);
  }

  /**
   * Subscribe to new entries.
   * @param {(e: AuditEntry) => void} fn
   * @returns {() => boolean}
   */
  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** @param {AuditEntry} entry */
  _notify(entry) {
    this.subscribers.forEach((fn) => {
      try {
        fn(entry);
      } catch (e) {
        console.warn('audit subscriber error', e);
      }
    });
  }

  /** Verify the entire chain. Returns { valid: bool, brokenAt?: number }. */
  async verify() {
    let prevHash = '0'.repeat(64);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.prevHash !== prevHash) return { valid: false, brokenAt: i, reason: 'prevHash mismatch' };
      const input = e.prevHash + e.seq + e.ts + e.actor + e.action + JSON.stringify(e.payload);
      const expected = await hash(input);
      if (e.hash !== expected) return { valid: false, brokenAt: i, reason: 'hash mismatch' };
      prevHash = e.hash;
    }
    return { valid: true };
  }

  /** Export as JSON for compliance submission. */
  export() {
    return JSON.stringify(this.entries, null, 2);
  }

  /** All entries. */
  all() {
    return this.entries.slice();
  }

  /** Filter by action prefix. @param {string} prefix */
  filter(prefix) {
    return this.entries.filter((e) => e.action.startsWith(prefix));
  }

  /** Most recent N entries. */
  recent(n = 20) {
    return this.entries.slice(-n);
  }

  /** Clear (testing only). */
  clear() {
    this.entries = [];
    this.lastHash = '0'.repeat(64);
  }
}

export const audit = new AuditLog();