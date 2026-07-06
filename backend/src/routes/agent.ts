import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idempotent, idempotencyKey } from '../idempotency.js';

const SignalSchema = z.object({
  kind: z.string().min(1).max(100),
  detail: z.string().max(500).optional(),
  metric: z.string().max(100).optional(),
  value: z.number().finite().optional(),
  severity: z.number().min(0).max(1).optional(),
});

const RunBody = z.object({
  satelliteId: z.string().min(1).max(200),
  signals: z.array(SignalSchema).max(50).default([]),
});

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/agent/run', async (req, reply) => {
    const body = RunBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const { status, body: out } = await idempotent(
      app.db,
      req.customerId,
      idempotencyKey(req.headers),
      async () => {
        const result = await app.agent.run(req.customerId, {
          satelliteId: body.data.satelliteId,
          signals: body.data.signals,
        });
        return { status: 201, body: result };
      },
    );
    return reply.code(status).send(out);
  });
}
