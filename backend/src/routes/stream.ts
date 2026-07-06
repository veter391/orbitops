import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { EventBus } from '../events/index.js';
import { issueTicket } from '../auth/ticket.js';

/**
 * WebSocket fan-out for the cockpit's "connected mode": telemetry and proposal
 * events pushed live to subscribed operators. Optional `?satelliteId=` filters
 * the stream to one spacecraft. This is additive — the browser app works fully
 * in demo mode without ever opening this socket.
 *
 * Connect flow: POST /v1/stream/ticket (with x-api-key) → short-lived ticket →
 * open WS at /v1/stream?ticket=... (so the API key never rides in a URL).
 */
export async function registerStreamRoutes(app: FastifyInstance, bus: EventBus): Promise<void> {
  await app.register(websocket);

  // Mint a short-lived ticket for the authenticated tenant.
  app.post('/v1/stream/ticket', async (req) => issueTicket(req.customerId));

  app.get<{ Querystring: { satelliteId?: string } }>(
    '/v1/stream',
    { websocket: true },
    (socket, req) => {
      const customerId = req.customerId; // pinned by the auth hook
      const filter = req.query.satelliteId;
      const OPEN = 1; // WebSocket.OPEN per the WHATWG spec — robust across ws builds
      const send = (type: string, data: unknown) => {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type, data }));
      };

      send('hello', { ts: new Date().toISOString(), filter: filter ?? null });

      const offTelemetry = bus.on('telemetry', (e) => {
        if (e.customerId !== customerId) return; // tenant isolation
        if (!filter || e.satelliteId === filter) send('telemetry', e);
      });
      const offProposal = bus.on('proposal', (e) => {
        if (e.customerId !== customerId) return; // tenant isolation
        if (!filter || e.proposal.satelliteId === filter) send('proposal', e);
      });

      const cleanup = () => {
        offTelemetry();
        offProposal();
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}
