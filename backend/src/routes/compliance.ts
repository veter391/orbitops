import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assessDeorbitCompliance, ballisticCoefficient } from '../orbital/decay.js';

const Body = z.object({
  altitudeKm: z.number().positive().max(2000), // FCC rule scopes the LEO region (< 2000 km)
  /** Provide the ballistic coefficient directly, or mass + area (+ optional Cd). */
  ballisticKgM2: z.number().positive().max(100_000).optional(),
  massKg: z.number().positive().max(1_000_000).optional(),
  areaM2: z.number().positive().max(10_000).optional(),
  cd: z.number().positive().max(10).optional(),
  /** Post-2024 LEO authorization (FCC 22-74 5-year rule) vs legacy 25-year guideline. */
  appliesFiveYearRule: z.boolean().default(true),
});

/**
 * Deorbit-compliance screening: a first-order natural-lifetime estimate vs the
 * applicable post-mission disposal window (FCC 22-74 5-year rule, or the 25-year
 * legacy guideline). Stateless calculator; authenticated like every /v1 route.
 */
export async function registerComplianceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/compliance/deorbit', async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const { altitudeKm, ballisticKgM2, massKg, areaM2, cd, appliesFiveYearRule } = body.data;
    const B =
      ballisticKgM2 ??
      (massKg !== undefined && areaM2 !== undefined ? ballisticCoefficient(massKg, areaM2, cd) : undefined);
    return assessDeorbitCompliance({ altitudeKm, ...(B !== undefined ? { ballisticKgM2: B } : {}), appliesFiveYearRule });
  });
}
