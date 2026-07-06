import { EventEmitter } from 'node:events';

export interface TelemetryEvent {
  satelliteId: string;
  count: number;
  metrics: string[];
}

export interface ProposalEvent {
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
    this.#em.emit(key, payload);
  }

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof BusEvents>(key: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.#em.on(key, fn as (p: unknown) => void);
    return () => this.#em.off(key, fn as (p: unknown) => void);
  }
}
