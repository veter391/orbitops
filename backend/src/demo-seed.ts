import type { FastifyInstance } from 'fastify';

/** The stable demo tenant seeded by migration 003 (api key `demo-key`). */
const DEMO_CUSTOMER = '00000000-0000-0000-0000-0000000000d0';

/**
 * Seed the demo tenant with a few realistic proposals so the PUBLIC demo's
 * Conjunction Watch and Agent triage show live backend output instead of an
 * empty queue. Uses the REAL agent pipeline — the probability-of-collision,
 * avoidance-burn and reasoning are genuine, not hand-written.
 *
 * Idempotent (skips when the tenant already has proposals) and flag-gated by
 * DEMO_SEED, so a real self-host / production deployment never runs it. The
 * container's pglite DB is ephemeral, so this re-seeds on each cold boot.
 */
export async function seedDemo(app: FastifyInstance): Promise<void> {
  const existing = await app.db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM proposals WHERE customer_id = $1',
    [DEMO_CUSTOMER],
  );
  if ((existing[0]?.n ?? 0) > 0) {
    app.log.info('demo seed: proposals already present, skipping');
    return;
  }

  /** A few plausible close approaches — real geometry drives real Pc screening. */
  const runs = [
    {
      satelliteId: 'STARLINK-1523',
      signals: [
        {
          kind: 'conjunction',
          detail: 'Cataloged debris — high-Pc close approach',
          missDistanceKm: 0.42,
          sigmaKm: 0.33,
          combinedRadiusKm: 0.02,
          timeToTcaSec: 6 * 3600,
          satMassKg: 260,
          ispSec: 1500,
          propellantBudgetKg: 2,
        },
      ],
    },
    {
      satelliteId: 'ONEWEB-0342',
      signals: [
        {
          kind: 'conjunction',
          detail: 'Secondary payload — moderate risk',
          missDistanceKm: 1.2,
          sigmaKm: 0.5,
          combinedRadiusKm: 0.02,
          timeToTcaSec: 14 * 3600,
          satMassKg: 150,
          ispSec: 1400,
          propellantBudgetKg: 1.5,
        },
      ],
    },
    {
      satelliteId: 'STARLINK-2087',
      signals: [
        {
          kind: 'conjunction',
          detail: 'Spent rocket body — low miss distance',
          missDistanceKm: 0.28,
          sigmaKm: 0.4,
          combinedRadiusKm: 0.03,
          timeToTcaSec: 3 * 3600,
          satMassKg: 260,
          ispSec: 1500,
          propellantBudgetKg: 2,
        },
      ],
    },
  ];

  let ok = 0;
  for (const run of runs) {
    try {
      await app.agent.run(DEMO_CUSTOMER, run);
      ok++;
    } catch (err) {
      app.log.warn({ err }, 'demo seed: agent run failed');
    }
  }
  app.log.info({ seeded: ok }, 'demo seed complete');
}
