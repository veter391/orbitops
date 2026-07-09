import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { getDb, type Db } from './db/index.js';
import { AuditLog } from './audit/index.js';
import { Proposals } from './proposals/index.js';
import { Telemetry } from './telemetry/index.js';
import { Feedback } from './feedback/index.js';
import { EventBus } from './events/index.js';
import { Agent } from './agent/index.js';
import { AgentMemory } from './agents/memory.js';
import { LexicalEmbedder } from './agents/embedder.js';
import { buildConfirmationGraph, type CompiledConfirmationGraph } from './agents/interruptible.js';
import { DbCheckpointSaver } from './agents/checkpointer.js';
import { registerAuth } from './auth/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerProposalRoutes } from './routes/proposals.js';
import { registerTelemetryRoutes } from './routes/telemetry.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerConjunctionRoutes } from './routes/conjunctions.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerComplianceRoutes } from './routes/compliance.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    audit: AuditLog;
    proposals: Proposals;
    telemetry: Telemetry;
    bus: EventBus;
    agent: Agent;
    feedback: Feedback;
    confirmationGraph: CompiledConfirmationGraph;
  }
}

/**
 * Build the Fastify app: attach the database and services, register routes.
 * Kept separate from process bootstrap (src/index.ts) so tests can drive it via
 * `.inject()` without opening a socket. Accepts an optional db for test isolation.
 */
export async function buildServer(db?: Db): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: config.BODY_LIMIT,
    // Correlation: honor an inbound X-Request-Id (proxy/client-provided), else
    // mint a UUID. Echoed on every response so a client can quote the id when
    // reporting an incident and logs can be joined end-to-end.
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : randomUUID();
    },
    logger: {
      level: config.LOG_LEVEL,
      // Never log the query string — it can carry the WebSocket `?apiKey=`.
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url.split('?')[0],
            remoteAddress: req.socket?.remoteAddress,
          };
        },
      },
    },
  });

  // Echo the correlation id on every response.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Security middleware, before auth and routes.
  await app.register(helmet);
  await app.register(cors, { origin: corsOrigin() });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  // OpenAPI spec (/openapi.json) + Swagger UI (/docs). Public docs; /v1 routes
  // still require the x-api-key documented as the security scheme.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'OrbitOps API',
        version: '0.1.0',
        description:
          'Open-source satellite-operations backend: HITL AI proposals, tamper-evident audit, telemetry, live stream. Authenticate with the x-api-key header (WebSocket uses a short-lived ticket).',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
      security: [{ apiKey: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', async () => app.swagger());

  // Fixed error shape; never leak internals (stack / SQL) to clients.
  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    else req.log.warn({ err: e.message }, 'request rejected');
    reply.code(status).send({ error: status >= 500 ? 'internal error' : (e.message ?? 'error') });
  });

  const database = db ?? (await getDb());
  const audit = new AuditLog(database, app.log);
  const bus = new EventBus();

  app.decorate('db', database);
  app.decorate('audit', audit);
  app.decorate('bus', bus);
  const proposals = new Proposals(database, audit, bus);
  app.decorate('proposals', proposals);
  const telemetry = new Telemetry(database, bus);
  app.decorate('telemetry', telemetry);
  // Similarity memory is opt-in (config): inject the offline lexical embedder so
  // AgentMemory activates recallSimilar/remember. Off → structured recall only.
  const memory = new AgentMemory(database, config.AGENT_SEMANTIC_MEMORY ? new LexicalEmbedder() : undefined);
  app.decorate('agent', new Agent(proposals, telemetry, memory, app.log));
  app.decorate('feedback', new Feedback(database));
  // Durable four-eyes confirmation graph (Track H) — backs POST /v1/proposals/:id/countersign.
  app.decorate('confirmationGraph', buildConfirmationGraph(new DbCheckpointSaver(database)));

  registerAuth(app); // pins req.customerId on every /v1 route; 401 without a valid key
  await registerHealthRoutes(app);
  await registerAuditRoutes(app);
  await registerProposalRoutes(app);
  await registerTelemetryRoutes(app);
  await registerStreamRoutes(app, bus);
  await registerAgentRoutes(app);
  await registerConjunctionRoutes(app);
  await registerFeedbackRoutes(app);
  await registerComplianceRoutes(app);
  return app;
}

/** CORS policy from config: an explicit allow-list, or same-origin only. */
function corsOrigin(): string[] | boolean {
  const list = config.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}
