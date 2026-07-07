import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseCdm, cdmToEncounter } from '../conjunction/cdm.js';
import { idempotent, idempotencyKey } from '../idempotency.js';

const CdmBody = z.object({
  cdm: z.string().min(1).max(100_000),
  /** Override the primary asset id (defaults to OBJECT1's designator). */
  satelliteId: z.string().max(200).optional(),
});

/**
 * Ingest a CCSDS Conjunction Data Message, derive the encounter geometry, and
 * run it through the agent — the real "a CDM arrives → the operator gets an
 * explainable, human-approval-gated proposal" flow.
 */
export async function registerConjunctionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/conjunctions/cdm', async (req, reply) => {
    const body = CdmBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });

    const cdm = parseCdm(body.data.cdm);
    const encounter = cdmToEncounter(cdm);
    const satelliteId = body.data.satelliteId ?? encounter.object1Designator ?? 'unknown';

    const { status, body: out } = await idempotent(
      app.db,
      req.customerId,
      idempotencyKey(req.headers),
      async () => {
        const result = await app.agent.run(req.customerId, {
          satelliteId,
          signals: [
            {
              kind: 'conjunction',
              missDistanceKm: encounter.missDistanceKm,
              combinedRadiusKm: encounter.combinedRadiusKm,
              // Omit non-positive values so the planner falls back to its own
              // defaults instead of dividing by a zero time-to-TCA.
              ...(encounter.timeToTcaSec > 0 ? { timeToTcaSec: encounter.timeToTcaSec } : {}),
              ...(encounter.sigmaKm !== undefined ? { sigmaKm: encounter.sigmaKm } : {}),
            },
          ],
        });
        return { status: 201, body: { encounter, ...result } };
      },
    );
    return reply.code(status).send(out);
  });
}
