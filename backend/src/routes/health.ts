import type { FastifyInstance } from 'fastify';

/** Liveness + database reachability, for load balancers and local sanity checks. */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let dbUp = false;
    try {
      await app.db.query('SELECT 1');
      dbUp = true;
    } catch (err) {
      app.log.error({ err }, 'health: database check failed');
    }
    return {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      ts: new Date().toISOString(),
    };
  });
}
