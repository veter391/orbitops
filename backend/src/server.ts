import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { getDb, type Db } from './db/index.js';
import { AuditLog } from './audit/index.js';
import { Proposals } from './proposals/index.js';
import { Telemetry } from './telemetry/index.js';
import { EventBus } from './events/index.js';
import { registerAuth } from './auth/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerProposalRoutes } from './routes/proposals.js';
import { registerTelemetryRoutes } from './routes/telemetry.js';
import { registerStreamRoutes } from './routes/stream.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    audit: AuditLog;
    proposals: Proposals;
    telemetry: Telemetry;
    bus: EventBus;
  }
}

/**
 * Build the Fastify app: attach the database and services, register routes.
 * Kept separate from process bootstrap (src/index.ts) so tests can drive it via
 * `.inject()` without opening a socket. Accepts an optional db for test isolation.
 */
export async function buildServer(db?: Db): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const database = db ?? (await getDb());
  const audit = new AuditLog(database);
  const bus = new EventBus();

  app.decorate('db', database);
  app.decorate('audit', audit);
  app.decorate('bus', bus);
  app.decorate('proposals', new Proposals(database, audit, bus));
  app.decorate('telemetry', new Telemetry(database, bus));

  registerAuth(app); // pins req.customerId on every /v1 route; 401 without a valid key
  await registerHealthRoutes(app);
  await registerAuditRoutes(app);
  await registerProposalRoutes(app);
  await registerTelemetryRoutes(app);
  await registerStreamRoutes(app, bus);
  return app;
}
