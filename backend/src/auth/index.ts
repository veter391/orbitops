import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { verifyTicket } from './ticket.js';
import { enterTenant, clearTenant } from '../db/tenant-context.js';

export interface Principal {
  operatorId: string;
  operatorName: string;
  customerId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved tenant for the request; set by the auth hook on every /v1 route. */
    customerId: string;
    /** Authenticated operator id (empty string on the ticket-authed WS path). */
    operatorId: string;
    /** Human-readable operator name, for display/audit context. */
    operatorName: string;
  }
}

/** sha256(key), hex — how API keys are stored (never in plaintext). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Resolve an API key to its operator (and the customer that operator belongs to). */
export async function principalByApiKey(db: Db, key: string): Promise<Principal | null> {
  const rows = await db.query<{ id: string; name: string; customer_id: string }>(
    'SELECT id, name, customer_id FROM operators WHERE api_key_hash = $1',
    [hashApiKey(key)],
  );
  const row = rows[0];
  return row ? { operatorId: row.id, operatorName: row.name, customerId: row.customer_id } : null;
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
  app.decorateRequest('operatorId', '');
  app.decorateRequest('operatorName', '');
  app.addHook('onRequest', async (req, reply) => {
    // FIRST, unconditionally: every request starts with NO tenant, so a request
    // that never authenticates (public route, 401) can never inherit a previous
    // request's tenant off a reused async continuation. Authenticated branches
    // below overwrite it with the resolved customer.
    clearTenant();

    const path = req.url.split('?')[0] ?? req.url;
    if (!path.startsWith('/v1/')) return;

    // Public product-feedback submission: a prospect on the marketing site has
    // no operator account, so the POST is whitelisted (rate-limited + validated
    // downstream). Reading feedback (GET /v1/feedback) still requires auth.
    if (path === '/v1/feedback' && req.method === 'POST') return;

    if (path === '/v1/stream') {
      const ticket = (req.query as { ticket?: string } | undefined)?.ticket;
      const customerId = ticket ? verifyTicket(ticket) : null;
      if (!customerId) return reply.code(401).send({ error: 'invalid or missing ticket' });
      req.customerId = customerId;
      enterTenant(customerId); // bind DB tenant context for RLS (no-op when DB_RLS off)
      req.log = req.log.child({ customerId });
      return;
    }

    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send({ error: 'missing API key' });
    }
    const principal = await principalByApiKey(app.db, key);
    if (!principal) return reply.code(401).send({ error: 'invalid API key' });
    req.customerId = principal.customerId;
    req.operatorId = principal.operatorId;
    req.operatorName = principal.operatorName;
    enterTenant(principal.customerId); // bind DB tenant context for RLS (no-op when DB_RLS off)
    // Tenant/operator correlation in every subsequent log line for this request.
    req.log = req.log.child({ customerId: principal.customerId, operatorId: principal.operatorId });
  });
}
