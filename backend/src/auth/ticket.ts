import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Short-lived, HMAC-signed WebSocket tickets. Browsers can't set custom headers
 * on a WS handshake, so the client first calls POST /v1/stream/ticket with its
 * API key (header), gets a ~60s ticket, and connects with `?ticket=`. The
 * long-lived API key therefore never appears in a URL (logs, history, Referer).
 */
const TTL_MS = 60_000;

// Dedicated ticket key (own blast radius); dev falls back to AUDIT_HMAC_KEY.
const TICKET_KEY = config.WS_TICKET_HMAC_KEY ?? config.AUDIT_HMAC_KEY;

function sign(payload: string): string {
  return createHmac('sha256', TICKET_KEY).update('ws-ticket:' + payload).digest('base64url');
}

export function issueTicket(customerId: string): { ticket: string; expiresInMs: number } {
  const payload = `${customerId}.${Date.now() + TTL_MS}`;
  const ticket = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  return { ticket, expiresInMs: TTL_MS };
}

/** Returns the customerId if the ticket is well-formed, unexpired, and correctly signed; else null. */
export function verifyTicket(ticket: string): string | null {
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) return null;
  const b64 = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const payload = Buffer.from(b64, 'base64url').toString('utf8');
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const sep = payload.lastIndexOf('.');
  const customerId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!customerId || !Number.isFinite(exp) || Date.now() > exp) return null;
  return customerId;
}
