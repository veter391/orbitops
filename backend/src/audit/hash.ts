import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Deterministic JSON serialization: keys sorted recursively, no incidental
 * whitespace. The audit hash must survive a round-trip through Postgres JSONB
 * (which reorders object keys and strips whitespace), so both the append side
 * and the verify side canonicalize the payload the same way before hashing.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

/** The exact byte string an entry's HMAC is computed over. */
export function entryInput(e: {
  prevHash: string;
  seq: number;
  tsMs: number;
  actor: string;
  action: string;
  payload: unknown;
}): string {
  return `${e.prevHash}|${e.seq}|${e.tsMs}|${e.actor}|${e.action}|${stableStringify(e.payload)}`;
}

/** Keyed HMAC-SHA-256 over the canonical entry input, hex-encoded. */
export function signEntry(input: string): string {
  return createHmac('sha256', config.AUDIT_HMAC_KEY).update(input).digest('hex');
}

/** Constant-time hex-hash comparison, so verify() can't leak via timing. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** The chain's genesis pointer — 64 hex zeros. */
export const GENESIS_HASH = '0'.repeat(64);
