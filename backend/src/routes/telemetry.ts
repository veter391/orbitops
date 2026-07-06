import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_BATCH } from '../telemetry/index.js';
import { idempotent, idempotencyKey } from '../idempotency.js';

const ReadingSchema = z.object({
  satelliteId: z.string().min(1).max(200),
  ts: z.string().datetime().optional(),
  subsystem: z.string().min(1).max(100),
  metric: z.string().min(1).max(100),
  value: z.number().finite(),
  unit: z.string().max(50).nullish(),
  quality: z.enum(['good', 'suspect', 'bad', 'stale']).optional(),
});

const IngestBody = z.object({
  readings: z.array(ReadingSchema).min(1).max(MAX_BATCH),
});

const QueryParams = z.object({
  satelliteId: z.string().min(1).max(200),
  metric: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(10000).optional(),
  bucketSeconds: z.coerce.number().int().positive().max(86400).optional(),
  agg: z.enum(['avg', 'min', 'max', 'last']).optional(),
});

const LatestQuery = z.object({ satelliteId: z.string().min(1).max(200) });

export async function registerTelemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/telemetry', async (req, reply) => {
    const body = IngestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const { status, body: out } = await idempotent(
      app.db,
      req.customerId,
      idempotencyKey(req.headers),
      async () => {
        const ingested = await app.telemetry.ingest(req.customerId, body.data.readings);
        return { status: 201, body: { ingested } };
      },
    );
    return reply.code(status).send(out);
  });

  app.get('/v1/telemetry', async (req, reply) => {
    const q = QueryParams.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    const { bucketSeconds, agg, ...rest } = q.data;
    if (bucketSeconds) {
      return {
        series: await app.telemetry.queryBucketed({
          customerId: req.customerId,
          ...rest,
          bucketSeconds,
          ...(agg ? { agg } : {}),
        }),
      };
    }
    return { points: await app.telemetry.queryRaw({ customerId: req.customerId, ...rest }) };
  });

  app.get('/v1/telemetry/latest', async (req, reply) => {
    const q = LatestQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', detail: q.error.issues });
    return { points: await app.telemetry.latestPerMetric(req.customerId, q.data.satelliteId) };
  });
}
