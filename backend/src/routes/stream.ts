import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { EventBus } from '../events/index.js';

/**
 * WebSocket fan-out for the cockpit's "connected mode": telemetry and proposal
 * events pushed live to subscribed operators. Optional `?satelliteId=` filters
 * the stream to one spacecraft. This is additive — the browser app works fully
 * in demo mode without ever opening this socket.
 */
export async function registerStreamRoutes(app: FastifyInstance, bus: EventBus): Promise<void> {
  await app.register(websocket);

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
