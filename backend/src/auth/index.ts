import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { verifyTicket } from './ticket.js';

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

/**
 * Require authentication on every `/v1/*` route and pin `req.customerId`.
 *
 * - The WebSocket path `/v1/stream` authenticates with a short-lived `?ticket=`
 *   (browsers can't set WS headers); verified before the upgrade so a bad ticket
 *   gets a clean 401.
 * - Every other `/v1/*` route uses the `x-api-key` header only — the API key is
 *   never accepted in a query string, so it can't leak into URLs/logs.
 *
 * `/health` stays public. All data access downstream is scoped by `customerId`,
 * so a missing or unknown credential can never reach tenant data.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('customerId', '');
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (!path.startsWith('/v1/')) return;

    if (path === '/v1/stream') {
      const ticket = (req.query as { ticket?: string } | undefined)?.ticket;
      const customerId = ticket ? verifyTicket(ticket) : null;
      if (!customerId) return reply.code(401).send({ error: 'invalid or missing ticket' });
      req.customerId = customerId;
      return;
    }

    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send({ error: 'missing API key' });
    }
    const customer = await customerByApiKey(app.db, key);
    if (!customer) return reply.code(401).send({ error: 'invalid API key' });
    req.customerId = customer.id;
  });
}
