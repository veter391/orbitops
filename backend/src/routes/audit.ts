import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// The actor is NEVER taken from the body — it is derived from the authenticated
// operator, exactly like proposal decisions. A client-supplied `actor` (or
// operatorId/operatorName in the payload) is ignored/overridden, so no
// authenticated user can attribute an audit entry to someone else or to the AI.
const AppendBody = z.object({
  action: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const RecentQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(), // seq to page before
});

const ExportQuery = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/audit', async (req, reply) => {
    const q = RecentQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    const entries = await app.audit.recent(req.customerId, q.data.limit, q.data.cursor);
    const nextCursor = entries.length === q.data.limit ? entries[entries.length - 1]!.seq : null;
    return { entries, nextCursor };
  });

  app.post('/v1/audit', async (req, reply) => {
    const body = AppendBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const entry = await app.audit.append(req.customerId, `user:${req.operatorId}`, body.data.action, {
      ...body.data.payload,
      operatorId: req.operatorId,
      operatorName: req.operatorName,
    });
    return reply.code(201).send({ entry });
  });

  app.get('/v1/audit/verify', async (req) => {
    return app.audit.verify(req.customerId);
  });

  app.get('/v1/audit/export', async (req, reply) => {
    const q = ExportQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    if (q.data.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orbitops-audit.csv"');
      return reply.send(await app.audit.exportCsv(req.customerId));
    }
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="orbitops-audit.json"');
    return reply.send(await app.audit.exportJson(req.customerId));
  });
}
