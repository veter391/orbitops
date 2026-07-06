import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { getDb, type Db } from './db/index.js';
import { registerHealthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

/**
 * Build the Fastify app: attach the database and register routes. Kept separate
 * from process bootstrap (src/index.ts) so tests can drive it via `.inject()`
 * without opening a socket.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  app.decorate('db', await getDb());
  await registerHealthRoutes(app);
  return app;
}
