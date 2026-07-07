// @ts-check
/**
 * backend-client.js — real HTTP/WS client for the OrbitOps backend.
 *
 * This is the seam for "connected mode": the same screens that run on the
 * in-browser simulation can instead read a LIVE backend — real telemetry, real
 * agent runs, and the tamper-evident audit chain — over the documented `/v1`
 * API. It is additive: with no backend configured the app stays fully in the
 * deterministic simulation (see {@link isConnected}).
 *
 * Contract notes (must match backend/src):
 *   - Auth is the `x-api-key` header on every `/v1` call. The key lives only in
 *     this browser's localStorage; it is never hardcoded and never placed in a
 *     URL (query strings leak via logs/history/Referer).
 *   - The WebSocket handshake can't carry custom headers, so streaming uses the
 *     ticket flow: POST /v1/stream/ticket (key in header) → short-lived ticket →
 *     open WS at /v1/stream?ticket=… .
 *   - Cross-origin browsers require the backend to allow this origin via its
 *     CORS_ORIGINS env (same-origin needs no config).
 *
 * @module core/backend-client
 */

'use strict';

const URL_KEY = 'orbitops:backend:url';
const API_KEY = 'orbitops:backend:key';
const MODE_KEY = 'orbitops:backend:mode'; // 'simulated' | 'connected'

/** Default backend origin for local development (backend config PORT default). */
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8790';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * @typedef {Object} BackendConfig
 * @property {string} url   Backend origin, e.g. https://api.orbitops.dev (no trailing /v1).
 * @property {string} key   Operator API key sent as x-api-key.
 * @property {'simulated'|'connected'} mode  Which data source the app reads.
 */

/** @returns {BackendConfig} the persisted backend config, with safe defaults. */
export function getBackendConfig() {
  let url = '';
  let key = '';
  let mode = /** @type {'simulated'|'connected'} */ ('simulated');
  try {
    url = localStorage.getItem(URL_KEY) || '';
    key = localStorage.getItem(API_KEY) || '';
    mode = localStorage.getItem(MODE_KEY) === 'connected' ? 'connected' : 'simulated';
  } catch {
    // localStorage unavailable (private mode) — fall back to simulated.
  }
  return { url, key, mode };
}

/**
 * Persist a partial backend config. Missing fields are left untouched.
 * @param {Partial<BackendConfig>} patch
 */
export function setBackendConfig(patch) {
  try {
    if (patch.url !== undefined) localStorage.setItem(URL_KEY, patch.url.trim().replace(/\/+$/, ''));
    if (patch.key !== undefined) localStorage.setItem(API_KEY, patch.key.trim());
    if (patch.mode !== undefined) localStorage.setItem(MODE_KEY, patch.mode);
  } catch {
    // Non-persisting session — the config still drives THIS page load via args.
  }
}

/**
 * Is the app in connected mode with enough config to reach a backend?
 * Requires mode=connected AND a URL AND a key — otherwise the simulation runs.
 * @returns {boolean}
 */
export function isConnected() {
  const c = getBackendConfig();
  return c.mode === 'connected' && Boolean(c.url) && Boolean(c.key);
}

/** An error carrying the HTTP status and the backend's `{error}` message. */
export class BackendError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = 'BackendError';
    /** @type {number} */
    this.status = status;
  }
}

/**
 * A thin, honest client bound to one backend config. Every method maps 1:1 to a
 * documented `/v1` route; failures throw {@link BackendError} with the real
 * status so callers can degrade gracefully (e.g. fall back to the simulation).
 */
export class BackendClient {
  /** @param {BackendConfig} [cfg] defaults to the persisted config. */
  constructor(cfg) {
    const c = cfg || getBackendConfig();
    /** @type {string} */
    this.baseUrl = (c.url || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
    /** @type {string} */
    this.apiKey = c.key || '';
  }

  /**
   * Core fetch: join the path, attach auth + JSON headers, enforce a timeout,
   * and turn a non-2xx into a {@link BackendError}. Never puts the key in a URL.
   * @param {string} path e.g. '/v1/proposals'
   * @param {{method?: string, body?: unknown, auth?: boolean, idempotencyKey?: string}} [opts]
   * @returns {Promise<any>}
   */
  async request(path, opts = {}) {
    const { method = 'GET', body, auth = true, idempotencyKey } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    /** @type {Record<string, string>} */
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers['x-api-key'] = this.apiKey;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) {
        const message = (data && data.error) || `HTTP ${res.status}`;
        throw new BackendError(message, res.status);
      }
      return data;
    } catch (e) {
      if (e instanceof BackendError) throw e;
      const err = /** @type {Error} */ (e);
      if (err.name === 'AbortError') {
        throw new BackendError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, 0);
      }
      // Network / CORS / DNS — status 0, message is the browser's.
      throw new BackendError(err.message || 'Network error', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────
  /** GET /health — no auth. Returns `{status, ...}`; throws on unreachable. */
  health() {
    return this.request('/health', { auth: false });
  }

  // ── Proposals / triage queue ────────────────────────────────────────────────
  /**
   * GET /v1/proposals — the triage queue (newest first), cursor-paginated.
   * @param {{limit?: number, cursor?: string}} [q]
   * @returns {Promise<{proposals: any[], nextCursor: string|null}>}
   */
  listProposals(q = {}) {
    const params = new URLSearchParams();
    if (q.limit) params.set('limit', String(q.limit));
    if (q.cursor) params.set('cursor', q.cursor);
    const qs = params.toString();
    return this.request(`/v1/proposals${qs ? `?${qs}` : ''}`);
  }

  /**
   * GET /v1/proposals/:id — one proposal with its full reasoning chain.
   * @param {string} id
   */
  getProposal(id) {
    return this.request(`/v1/proposals/${encodeURIComponent(id)}`);
  }

  /**
   * POST /v1/proposals/:id/approve — HITL approve; audited as this operator.
   * @param {string} id
   */
  approveProposal(id) {
    return this.request(`/v1/proposals/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
  }

  /**
   * POST /v1/proposals/:id/reject — HITL reject with a reason.
   * @param {string} id @param {string} [reason]
   */
  rejectProposal(id, reason = '') {
    return this.request(`/v1/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason },
    });
  }

  /**
   * POST /v1/proposals/:id/modify — HITL modify the proposed action.
   * @param {string} id @param {Record<string, unknown>} modifications
   */
  modifyProposal(id, modifications) {
    return this.request(`/v1/proposals/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: { modifications },
    });
  }

  // ── Agent ───────────────────────────────────────────────────────────────────
  /**
   * POST /v1/agent/run — run the multi-agent graph over signals; the result is
   * persisted as a PENDING proposal (never auto-executed).
   * @param {{satelliteId: string, signals: Record<string, unknown>[], idempotencyKey?: string}} input
   */
  runAgent(input) {
    return this.request('/v1/agent/run', {
      method: 'POST',
      body: { satelliteId: input.satelliteId, signals: input.signals },
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * POST /v1/conjunctions/cdm — ingest a raw CCSDS CDM, screen it, and get back
   * the encounter geometry plus a pending proposal.
   * @param {string} cdm raw KVN text @param {string} [satelliteId] override primary asset id
   */
  screenCdm(cdm, satelliteId) {
    return this.request('/v1/conjunctions/cdm', {
      method: 'POST',
      body: satelliteId ? { cdm, satelliteId } : { cdm },
    });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  /**
   * GET /v1/audit — recent audit entries (newest first), cursor-paginated.
   * @param {{limit?: number, cursor?: string}} [q]
   */
  auditRecent(q = {}) {
    const params = new URLSearchParams();
    if (q.limit) params.set('limit', String(q.limit));
    if (q.cursor) params.set('cursor', q.cursor);
    const qs = params.toString();
    return this.request(`/v1/audit${qs ? `?${qs}` : ''}`);
  }

  /** GET /v1/audit/verify — server-side hash-chain integrity check. */
  verifyAudit() {
    return this.request('/v1/audit/verify');
  }

  /** GET /v1/audit/export — the full chain as a downloadable JSON payload. */
  exportAudit() {
    return this.request('/v1/audit/export');
  }

  // ── Telemetry ───────────────────────────────────────────────────────────────
  /** GET /v1/telemetry/latest — the most recent sample per satellite. */
  latestTelemetry() {
    return this.request('/v1/telemetry/latest');
  }

  /**
   * GET /v1/telemetry — historical samples, cursor-paginated.
   * @param {{satelliteId?: string, limit?: number, cursor?: string}} [q]
   */
  telemetry(q = {}) {
    const params = new URLSearchParams();
    if (q.satelliteId) params.set('satelliteId', q.satelliteId);
    if (q.limit) params.set('limit', String(q.limit));
    if (q.cursor) params.set('cursor', q.cursor);
    const qs = params.toString();
    return this.request(`/v1/telemetry${qs ? `?${qs}` : ''}`);
  }

  // ── Live stream (WebSocket) ─────────────────────────────────────────────────
  /**
   * Open the live event stream. Performs the ticket handshake, then connects the
   * WebSocket (key never rides in the URL — only the short-lived ticket does).
   * @param {(evt: {type: string, data: unknown}) => void} onEvent
   * @param {{satelliteId?: string, onError?: (e: Event) => void, onClose?: () => void}} [opts]
   * @returns {Promise<WebSocket>} the open socket (call `.close()` to stop).
   */
  async openStream(onEvent, opts = {}) {
    const { ticket } = await this.request('/v1/stream/ticket', { method: 'POST', body: {} });
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    const params = new URLSearchParams({ ticket });
    if (opts.satelliteId) params.set('satelliteId', opts.satelliteId);
    const ws = new WebSocket(`${wsBase}/v1/stream?${params.toString()}`);
    ws.addEventListener('message', (ev) => {
      const parsed = safeJson(typeof ev.data === 'string' ? ev.data : '');
      if (parsed) onEvent(parsed);
    });
    if (opts.onError) ws.addEventListener('error', opts.onError);
    if (opts.onClose) ws.addEventListener('close', opts.onClose);
    return ws;
  }
}

/** @param {string} text @returns {any} parsed JSON, or null if malformed. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
