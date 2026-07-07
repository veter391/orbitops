import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseCdm, validateCdm, cdmToEncounter } from '../conjunction/cdm.js';
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
    // Reject structurally/physically invalid CDMs (missing mandatory fields,
    // negative miss distance, missing an object) instead of scoring garbage into
    // a spurious verdict. This route calls the agent directly, so it is the
    // trust boundary — there is no downstream zod schema to catch bad geometry.
    const problems = validateCdm(cdm);
    if (problems.length) return reply.code(400).send({ error: 'invalid CDM', detail: problems });

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
              // A zero/missing time-to-TCA is not a usable maneuver horizon, so
              // omit it — the planner then sizes the burn from its default safe
              // horizon instead of a degenerate value.
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
