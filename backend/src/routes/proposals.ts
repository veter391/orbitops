import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../proposals/index.js';
import { idempotent, idempotencyKey } from '../idempotency.js';

const CreateBody = z.object({
  satelliteId: z.string().max(200).nullish(),
  reasoningChain: z.array(z.unknown()).default([]),
  proposedAction: z.record(z.string(), z.unknown()).default({}),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  cursor: z.string().datetime().optional(), // ts to page before
});

const IdParams = z.object({ id: z.string().uuid() });

// The operator is taken from the authenticated principal (req.operatorId), never
// from the request body — so the audit trail records who actually authenticated.
const ApproveBody = z.object({});
const RejectBody = z.object({ reason: z.string().max(2000).default('') });
const ModifyBody = z.object({ modifications: z.record(z.string(), z.unknown()) });

export async function registerProposalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/proposals', async (req, reply) => {
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const { status, body: out } = await idempotent(
      app.db,
      req.customerId,
      idempotencyKey(req.headers),
      async () => {
        const p = await app.proposals.create(req.customerId, {
          satelliteId: body.data.satelliteId ?? null,
          reasoningChain: body.data.reasoningChain,
          proposedAction: body.data.proposedAction,
        });
        return { status: 201, body: { proposal: p } };
      },
    );
    return reply.code(status).send(out);
  });

  app.get('/v1/proposals', async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    const proposals = await app.proposals.list(req.customerId, q.data.limit, q.data.cursor);
    const nextCursor = proposals.length === q.data.limit ? proposals[proposals.length - 1]!.ts : null;
    return { proposals, nextCursor };
  });

  app.get('/v1/proposals/:id', async (req, reply) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid id' });
    const p = await app.proposals.get(req.customerId, params.data.id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    return { proposal: p };
  });

  const decision = (
    verb: 'approve' | 'reject' | 'modify',
    handler: (
      customerId: string,
      op: { id: string; name: string },
      id: string,
      body: Record<string, unknown>,
    ) => Promise<unknown>,
    schema: z.ZodType,
  ) => {
    app.post(`/v1/proposals/:id/${verb}`, async (req, reply) => {
      const params = IdParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid id' });
      const body = schema.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
      try {
        const proposal = await handler(
          req.customerId,
          { id: req.operatorId, name: req.operatorName },
          params.data.id,
          body.data as Record<string, unknown>,
        );
        return { proposal };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not found' });
        throw err;
      }
    });
  };

  decision('approve', (cid, op, id) => app.proposals.approve(cid, id, op), ApproveBody);
  decision(
    'reject',
    (cid, op, id, b) => app.proposals.reject(cid, id, op, b['reason'] as string),
    RejectBody,
  );
  decision(
    'modify',
    (cid, op, id, b) =>
      app.proposals.modify(cid, id, op, b['modifications'] as Record<string, unknown>),
    ModifyBody,
  );
}
