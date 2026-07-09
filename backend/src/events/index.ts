import { EventEmitter } from 'node:events';

export interface TelemetryEvent {
  customerId: string;
  satelliteId: string;
  count: number;
  metrics: string[];
}

export interface ProposalEvent {
  customerId: string;
  type: 'created' | 'approved' | 'rejected' | 'modified';
  proposal: { id: string; satelliteId: string | null; status: string };
}

export interface BusEvents {
  telemetry: TelemetryEvent;
  proposal: ProposalEvent;
}

/**
 * In-process typed pub/sub. Services publish domain events; the WebSocket stream
 * fans them out to connected operators (the cockpit's "connected mode"). Kept
 * in-process for now — a multi-node deployment would back this with Redis
 * pub/sub, but the publish/subscribe surface here would not change.
 */
export class EventBus {
  readonly #em = new EventEmitter();

  constructor() {
    // One listener pair per open socket; lift the default cap.
    this.#em.setMaxListeners(0);
  }

  emit<K extends keyof BusEvents>(key: K, payload: BusEvents[K]): void {
    // NOTE: listeners run synchronously in the EMITTER's async context. If a
    // listener ever issues a tenant-scoped DB query (rlsScopedDb), it would pick
    // up the emitter's tenant, not its own — so a listener that needs to query
    // must establish its own tenant context (runWithTenant) first. Current
    // listeners (routes/stream.ts) only read a pre-captured customerId, so this
    // is a guard-rail for future ones, not a present bug.
    this.#em.emit(key, payload);
  }

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof BusEvents>(key: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.#em.on(key, fn as (p: unknown) => void);
    return () => this.#em.off(key, fn as (p: unknown) => void);
  }
}
