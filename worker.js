/**
 * Thin server-side proxy for OrbitOps's shared (no-BYOK) live-AI mode.
 *
 * Why this exists: OrbitOps is otherwise a pure static site with zero
 * backend. A shared OpenRouter key CANNOT be shipped to the browser --
 * anything in client JS is trivially extractable via devtools, no amount of
 * obfuscation changes that. So the shared key lives ONLY as a Cloudflare
 * secret (`wrangler secret put OPENROUTER_KEY`), never in source, never in
 * the deployed bundle, and this Worker is the only thing that ever sees it.
 *
 * The Worker is content-agnostic: it forwards a `messages` array to
 * OpenRouter and returns the model's JSON completion. The three-agent
 * pipeline (analyst -> strategist -> safety reviewer) lives entirely in the
 * browser (src/core/llm-agents.js) and just points at /api/ai instead of at
 * OpenRouter directly when the operator hasn't supplied their own key.
 *
 * Everything that isn't a POST to /api/ai falls straight through to the
 * static asset handler -- this Worker does not touch the rest of the app.
 *
 * MODEL SELECTION is dynamic, not a hardcoded list -- see pickFreeModels()
 * below. A hardcoded model ID is a real, observed failure mode: OpenRouter's
 * free-tier catalog changes (models get added, retired, or stop being free)
 * independently of this codebase. Instead this fetches the live catalog,
 * ranks free text models, and falls back through three layers if that fetch
 * itself fails -- see the docstring on pickFreeModels for the exact order.
 *
 * LIVE BACKEND (Cloudflare Containers): the open-source Node backend runs in a
 * container fronted by this same Worker. Requests to `/v1/*` and `/health` (incl.
 * WebSocket upgrades) are forwarded to the container; the container reseeds its
 * embedded pglite DB on boot (ephemeral, correct for a public demo). The
 * container's AUDIT_HMAC_KEY is a Worker secret forwarded via the class `envVars`.
 *
 * @module worker
 */

import { Container, getContainer } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';

/**
 * The OrbitOps backend container. Fastify listens on 0.0.0.0:8790 inside the
 * image (see backend/Dockerfile). Scales to zero after 10m idle. The audit-chain
 * secret is passed into the container's process env (config refuses a weak/dev
 * key in production).
 */
export class Backend extends Container {
  defaultPort = 8790;
  sleepAfter = '10m';
  envVars = {
    AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY,
  };
}

// General instruct models tried FIRST (in this order) when still free. The
// agent pipeline asks each model for a small, strict JSON object (an
// assessment, a recommendation, a review) -- reliable instruction-following
// and clean JSON matter more here than raw parameter count, and the
// "reasoning" is supplied by the three-stage pipeline structure itself, not
// by any single model's chain-of-thought. Big always-on reasoning models
// stay in the chain (via the ranked tail) but not in front of every request,
// because they add 10-20s of thinking latency and more often wrap their JSON
// in prose. Any model that loses free status is skipped automatically.
const PREFERRED_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
];

// Absolute last resort ONLY -- used if OpenRouter's /models endpoint is
// unreachable AND there's no cached catalog at all yet (i.e. this Worker
// isolate has never successfully fetched the live list). Kept short and only
// as a final safety net, not the primary source of truth.
const HARDCODED_FALLBACK = ['meta-llama/llama-3.3-70b-instruct:free', 'nvidia/nemotron-nano-9b-v2:free'];

const CATALOG_CACHE_TTL_SECONDS = 3600; // 1h -- free-tier catalog doesn't change minute to minute
// Cache key only (never fetched). Bump the suffix whenever the ranking logic
// changes so a stale cached ordering doesn't linger for up to an hour.
const CATALOG_CACHE_URL = 'https://orbitops.internal/free-model-catalog-v1';

// Cloudflare's native rate-limit binding only supports 10s/60s windows
// (burst protection), not a real "N per hour" quota -- see wrangler.toml.
// One scenario run fires three sequential agent calls, so this is sized to
// allow a few full runs per minute per visitor while still stopping a single
// client from draining the shared free-tier quota for everyone else.
const RATE_LIMIT_WINDOW_LABEL = '15 requests per 60s per visitor';
// Per-model timeout: generous enough for a capable model to finish a full
// reasoning JSON without a stuck/queued one dragging on forever.
const REQUEST_TIMEOUT_MS = 22000;
// Overall wall-clock cap across ALL model attempts in a single /api/ai call.
// Past this, give up and let the client fall back to the deterministic
// simulated narrative instead of stacking timeout after timeout.
const OVERALL_BUDGET_MS = 38000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/ai' && request.method === 'POST') {
      return handleAIProxy(request, env, ctx);
    }

    // Live backend: forward the API + health + WebSocket upgrades to the
    // container. getContainer(...).fetch() proxies to Fastify (WS included).
    // Only present when the container binding is configured (live demo build);
    // a plain static deploy without the binding falls through to assets.
    if ((url.pathname.startsWith('/v1/') || url.pathname === '/health') && env.BACKEND) {
      return getContainer(env.BACKEND).fetch(request);
    }

    // Everything else: serve the static site as normal.
    return env.ASSETS.fetch(request);
  },
};

/**
 * Fetch and rank the current free-tier text models from OpenRouter's own
 * catalog, cached via the Workers Cache API for an hour so we don't hit
 * /models on every agent call. Three-layer fallback:
 *
 *   1. Fresh live fetch (or a cache hit within the TTL) -- the normal path.
 *   2. A stale cached catalog, if the live fetch fails but we have *any*
 *      previously-cached result (better an hour-old real list than nothing).
 *   3. HARDCODED_FALLBACK, only if neither of the above ever worked.
 *
 * The actual safety net is that every model response still goes through
 * strict JSON validation both here and in the browser, so a poorly-ranked
 * model just costs a wasted round-trip before the next one, never a wrong
 * result reaching the operator.
 */
async function pickFreeModels(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(CATALOG_CACHE_URL);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const ranked = rankFreeModels(data.data || []);
      if (ranked.length > 0) {
        const cacheResponse = new Response(JSON.stringify(ranked), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_CACHE_TTL_SECONDS}` },
        });
        ctx.waitUntil(cache.put(cacheKey, cacheResponse));
        return ranked;
      }
    }
  } catch {
    // fall through to cache / hardcoded fallback below
  }

  const cached = await cache.match(cacheKey);
  if (cached) {
    const stale = await cached.json().catch(() => null);
    if (Array.isArray(stale) && stale.length > 0) return stale;
  }

  return HARDCODED_FALLBACK;
}

/**
 * Extract text-capable free models and rank them: non-coding, non-reasoning
 * ("instruct") models first, then by approximate size. Curated PREFERRED
 * models (if still free) are pulled to the front of that ordering.
 */
function rankFreeModels(models) {
  const ranked = models
    .filter((m) => m.id?.endsWith(':free'))
    .filter((m) => m.architecture?.modality === 'text->text' || m.architecture?.input_modalities?.includes('text'))
    .map((m) => ({
      id: m.id,
      coding: /code|coder/i.test(m.id) ? 1 : 0,
      reasoning: m.reasoning?.default_enabled ? 1 : 0,
      size: parseParamCount(m.name, m.description),
      ctx: m.context_length || 0,
    }))
    .sort((a, b) => a.coding - b.coding || a.reasoning - b.reasoning || b.size - a.size || b.ctx - a.ctx)
    .map((m) => m.id);

  const available = new Set(ranked);
  const front = PREFERRED_MODELS.filter((id) => available.has(id));
  const frontSet = new Set(front);
  return [...front, ...ranked.filter((id) => !frontSet.has(id))];
}

/** Best-effort "how many billions of parameters" guess from free-text model metadata. */
function parseParamCount(name = '', description = '') {
  const text = `${name} ${description}`;
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*B\b/gi)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((m) => parseFloat(m[1])));
}

async function handleAIProxy(request, env, ctx) {
  if (!env.OPENROUTER_KEY) {
    return json({ ok: false, error: 'Shared AI is not configured on this deployment.' }, 503);
  }

  // Fair-use limit so one visitor can't burn the whole shared free-tier quota
  // for everyone else. Best-effort (Workers Rate Limiting binding), not a hard
  // security boundary -- there is nothing sensitive to protect beyond quota
  // fairness, since this only ever calls free models.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.AI_RATE_LIMITER) {
    const { success } = await env.AI_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return json(
        {
          ok: false,
          error: `Shared AI is rate-limited (${RATE_LIMIT_WINDOW_LABEL}). Wait a moment, or add your own OpenRouter key in the agent panel to skip this limit.`,
          isRateLimited: true,
        },
        429
      );
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return json({ ok: false, error: 'messages array is required.' }, 400);
  }
  // Cap prompt size server-side too -- defense in depth, don't just trust the
  // client to have already truncated the input.
  const totalChars = messages.reduce((n, m) => n + String(m?.content || '').length, 0);
  if (totalChars > 8000) {
    return json({ ok: false, error: 'Prompt too long.' }, 400);
  }

  const models = shufflePreferred(await pickFreeModels(env, ctx));
  let lastError = 'Unknown error';
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  for (const model of models) {
    if (Date.now() > deadline) {
      lastError = 'No model responded within the time budget';
      break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://orbitops.workers.dev',
          'X-Title': 'OrbitOps (shared)',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: body.temperature ?? 0.4,
          // The agents return small, strict JSON objects. Do NOT send
          // reasoning:{enabled:false} -- it 400s on reasoning-mandatory
          // endpoints (gpt-oss) and knocks fast models out of the pool.
          // Truncation is caught by the JSON check below.
          max_tokens: Math.min(body.maxTokens ?? 900, 1200),
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const upstream = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = upstream?.error?.message || `HTTP ${res.status}`;
        continue; // try the next model in the chain
      }
      const content = upstream?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = 'Empty completion';
        continue;
      }
      // Every caller wants JSON -- validate it parses before returning. A
      // truncated / non-JSON answer (some free models ignore response_format,
      // or run out of tokens mid-object) is treated as a failure so we fall
      // through to the next model instead of handing the browser a broken
      // string it can't use.
      if (!isValidJsonObject(content)) {
        lastError = `${model} returned non-JSON / truncated output`;
        continue;
      }
      return json({ ok: true, content, model });
    } catch (e) {
      clearTimeout(timer);
      lastError = e.name === 'AbortError' ? `${model} timed out` : e.message;
    }
  }

  return json({ ok: false, error: `All shared models failed. Last error: ${lastError}` }, 502);
}

/**
 * Randomize the order of the capable (preferred) models per request so that
 * when several are available you get variety across the three agent calls and
 * across runs, instead of always hitting the same one. The non-preferred
 * ranked tail stays in place as the deterministic fallback order.
 */
function shufflePreferred(models) {
  const front = models.filter((id) => PREFERRED_MODELS.includes(id));
  const tail = models.filter((id) => !PREFERRED_MODELS.includes(id));
  for (let i = front.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [front[i], front[j]] = [front[j], front[i]];
  }
  return [...front, ...tail];
}

/** True if `text` contains a parseable JSON object (tolerating prose around it). */
function isValidJsonObject(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
