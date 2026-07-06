import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';

export interface Customer {
  id: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved tenant for the request; set by the auth hook on every /v1 route. */
    customerId: string;
  }
}

/** sha256(key), hex — how API keys are stored (never in plaintext). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function customerByApiKey(db: Db, key: string): Promise<Customer | null> {
  const rows = await db.query<Customer>(
    'SELECT id, name FROM customers WHERE api_key_hash = $1',
    [hashApiKey(key)],
  );
  return rows[0] ?? null;
}

/** Header first (services/CLI), then `?apiKey=` (browsers can't set WS headers). */
function extractKey(req: FastifyRequest): string | null {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  const q = (req.query as { apiKey?: string } | undefined)?.apiKey;
  return typeof q === 'string' && q.length > 0 ? q : null;
}

/**
 * Require a valid API key on every `/v1/*` route and pin `req.customerId`.
 * `/health` stays public. All data access downstream is scoped by that id, so a
 * missing or unknown key can never reach tenant data.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('customerId', '');
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const key = extractKey(req);
    if (!key) return reply.code(401).send({ error: 'missing API key' });
    const customer = await customerByApiKey(app.db, key);
    if (!customer) return reply.code(401).send({ error: 'invalid API key' });
    req.customerId = customer.id;
  });
}
