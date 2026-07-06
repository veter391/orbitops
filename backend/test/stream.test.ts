import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
let port: number;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = (app.server.address() as AddressInfo).port;
});
after(async () => {
  await app.close();
});

interface Frame {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Buffer every frame from the moment the socket is created, so a frame the
 * server sends immediately on connect (the `hello`) is never lost to a
 * listener-attached-too-late race.
 */
function collect(ws: WebSocket): {
  waitFor: (p: (f: Frame) => boolean, timeoutMs?: number) => Promise<Frame>;
  none: (p: (f: Frame) => boolean, windowMs?: number) => Promise<boolean>;
} {
  const frames: Frame[] = [];
  const waiters = new Set<(f: Frame) => void>();
  ws.on('message', (raw: WebSocket.RawData) => {
    const f = JSON.parse(raw.toString()) as Frame;
    frames.push(f);
    for (const w of waiters) w(f);
  });
  return {
    waitFor(pred, timeoutMs = 2000) {
      const seen = frames.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const w = (f: Frame) => {
          if (pred(f)) {
            clearTimeout(timer);
            waiters.delete(w);
            resolve(f);
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(w);
          reject(new Error('timed out waiting for frame'));
        }, timeoutMs);
        waiters.add(w);
      });
    },
    none(pred, windowMs = 400) {
      if (frames.some(pred)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const w = (f: Frame) => {
          if (pred(f)) {
            clearTimeout(timer);
            waiters.delete(w);
            resolve(false);
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(w);
          resolve(true);
        }, windowMs);
        waiters.add(w);
      });
    },
  };
}

test('stream pushes telemetry and proposal events for the subscribed satellite', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?satelliteId=oo1-01&apiKey=${DEMO_KEY}`);
  const frames = collect(ws);
  await once(ws, 'open');

  const hello = await frames.waitFor((f) => f.type === 'hello');
  assert.equal(hello.data.filter, 'oo1-01');

  await app.inject({
    method: 'POST',
    url: '/v1/telemetry',
    headers: AUTH,
    payload: { readings: [{ satelliteId: 'oo1-01', subsystem: 'pwr', metric: 'battery_v', value: 27 }] },
  });
  const tel = await frames.waitFor((f) => f.type === 'telemetry');
  assert.equal(tel.data.satelliteId, 'oo1-01');
  assert.equal(tel.data.count, 1);

  await app.inject({
    method: 'POST',
    url: '/v1/proposals',
    headers: AUTH,
    payload: { satelliteId: 'oo1-01', proposedAction: { burnSeconds: 5 } },
  });
  const prop = await frames.waitFor((f) => f.type === 'proposal');
  assert.equal((prop.data as { type: string }).type, 'created');

  ws.close();
});

test('stream filter excludes events for other satellites', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?satelliteId=oo1-01&apiKey=${DEMO_KEY}`);
  const frames = collect(ws);
  await once(ws, 'open');
  await frames.waitFor((f) => f.type === 'hello');

  await app.inject({
    method: 'POST',
    url: '/v1/telemetry',
    headers: AUTH,
    payload: { readings: [{ satelliteId: 'other-sat', subsystem: 'pwr', metric: 'battery_v', value: 27 }] },
  });
  assert.equal(
    await frames.none((f) => f.type === 'telemetry'),
    true,
    'no telemetry frame should arrive for a different satellite',
  );

  ws.close();
});
