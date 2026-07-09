import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/index.js';

// Bounded free-text fields — public write, so keep every field short to blunt
// abuse and keep rows small.
const str = (max: number) => z.string().max(max).optional();

const CreateBody = z.object({
  kind: z.string().min(1).max(40),
  source: str(60),
  tier: str(40),
  wantsCloud: str(60),
  fleetSize: str(80),
  note: str(2000),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});

/**
 * Product feedback. `POST /v1/feedback` is PUBLIC (whitelisted in the auth hook)
 * so a prospect with no operator account can submit the pricing brief; it is
 * rate-limited and strictly validated. `GET /v1/feedback` is owner-facing — it is
 * gated to the 'admin' role (not just any authenticated operator), since feedback
 * is not tenant-scoped and a regular operator has no business reading every
 * prospect's submission.
 */
export async function registerFeedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/feedback', async (req, reply) => {
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const row = await app.feedback.create(body.data);
    return reply.code(201).send({ ok: true, id: row.id });
  });

  app.get('/v1/feedback', { preHandler: requireRole('admin') }, async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    const feedback = await app.feedback.recent(q.data.limit);
    return { feedback };
  });
}
