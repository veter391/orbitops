import type { Db } from './db/index.js';

export interface Outcome {
  status: number;
  body: unknown;
}

/**
 * Run `produce` at most once per (tenant, Idempotency-Key). A retry with the same
 * key returns the stored response instead of re-executing — so a client that
 * retries a POST after a timeout doesn't create duplicate proposals/telemetry.
 *
 * With no key, `produce` simply runs (no idempotency). Note: this dedupes
 * sequential retries (the common case); it is not a substitute for a lock under
 * truly concurrent same-key requests.
 */
export async function idempotent(
  db: Db,
  customerId: string,
  key: string | null,
  produce: () => Promise<Outcome>,
): Promise<Outcome> {
  if (!key) return produce();

  const seen = await db.query<{ status: number; body: unknown }>(
    'SELECT status, body FROM idempotency_keys WHERE customer_id = $1 AND key = $2',
    [customerId, key],
  );
  if (seen[0]) return { status: seen[0].status, body: seen[0].body };

  const out = await produce();
  await db.query(
    `INSERT INTO idempotency_keys (customer_id, key, status, body)
     VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
    [customerId, key, out.status, JSON.stringify(out.body)],
  );
  return out;
}

/** Extract the Idempotency-Key header if present and non-empty. */
export function idempotencyKey(headers: Record<string, unknown>): string | null {
  const h = headers['idempotency-key'];
  return typeof h === 'string' && h.length > 0 && h.length <= 200 ? h : null;
}
