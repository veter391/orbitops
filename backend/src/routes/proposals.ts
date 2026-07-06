import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../proposals/index.js';

const CreateBody = z.object({
  satelliteId: z.string().max(200).nullish(),
  reasoningChain: z.array(z.unknown()).default([]),
  proposedAction: z.record(z.string(), z.unknown()).default({}),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const IdParams = z.object({ id: z.string().uuid() });

const Operator = z.object({ operator: z.string().min(1).max(200) });
const RejectBody = Operator.extend({ reason: z.string().max(2000).default('') });
const ModifyBody = Operator.extend({ modifications: z.record(z.string(), z.unknown()) });

export async function registerProposalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/proposals', async (req, reply) => {
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const p = await app.proposals.create(req.customerId, {
      satelliteId: body.data.satelliteId ?? null,
      reasoningChain: body.data.reasoningChain,
      proposedAction: body.data.proposedAction,
    });
    return reply.code(201).send({ proposal: p });
  });

  app.get('/v1/proposals', async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    return { proposals: await app.proposals.list(req.customerId, q.data.limit) };
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
    handler: (customerId: string, id: string, body: Record<string, unknown>) => Promise<unknown>,
    schema: z.ZodType,
  ) => {
    app.post(`/v1/proposals/:id/${verb}`, async (req, reply) => {
      const params = IdParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid id' });
      const body = schema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
      try {
        const proposal = await handler(req.customerId, params.data.id, body.data as Record<string, unknown>);
        return { proposal };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not found' });
        throw err;
      }
    });
  };

  decision('approve', (cid, id, b) => app.proposals.approve(cid, id, b['operator'] as string), Operator);
  decision(
    'reject',
    (cid, id, b) => app.proposals.reject(cid, id, b['operator'] as string, b['reason'] as string),
    RejectBody,
  );
  decision(
    'modify',
    (cid, id, b) =>
      app.proposals.modify(cid, id, b['operator'] as string, b['modifications'] as Record<string, unknown>),
    ModifyBody,
  );
}
