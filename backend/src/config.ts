import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Secrets that support the `<NAME>_FILE` convention: if `<NAME>_FILE` is set, the
 * secret is read from that file path (trimmed) instead of the inline env var.
 * This is how Docker/Kubernetes/Cloudflare mount secrets (a file, not an env
 * string that leaks into `docker inspect` / process listings). The inline var
 * still works for local dev; the file wins when both are present.
 */
const FILE_BACKED_SECRETS = ['AUDIT_HMAC_KEY', 'OPENROUTER_API_KEY', 'DATABASE_URL'] as const;

/** Resolve `<NAME>_FILE` secrets into `<NAME>` on a copy of the given env. Pure. */
export function resolveSecretsFromFiles(
  env: NodeJS.ProcessEnv,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of FILE_BACKED_SECRETS) {
    const filePath = out[`${name}_FILE`];
    if (filePath && filePath.trim()) {
      const value = read(filePath.trim()).trim();
      if (!value) throw new Error(`${name}_FILE (${filePath}) is empty — refusing to boot with a blank secret.`);
      out[name] = value;
    }
  }
  return out;
}

/**
 * All runtime configuration comes from the environment, validated once at boot.
 * Sane local defaults keep `git clone && npm i && npm run dev` working with no
 * setup; every value is overridable via a gitignored `.env` (see .env.example)
 * or, for secrets, via a mounted `<NAME>_FILE` (see resolveSecretsFromFiles).
 */
const EnvSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65535).default(8790),
  DATA_DIR: z.string().default('./.data/pgdata'),
  /** When set, use a managed Postgres (prod) instead of local pglite (dev). */
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Comma-separated CORS allow-list; empty = same-origin only (no cross-origin). */
  CORS_ORIGINS: z.string().default(''),
  /** Max requests per IP per window before 429. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /** Max request body size in bytes (default 1 MiB). */
  BODY_LIMIT: z.coerce.number().int().positive().default(1_048_576),

  /** When set (e.g. http://localhost:4318/v1/traces), export OTLP spans there. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  /** Days of telemetry to keep; 0 = keep forever (purge loop disabled). */
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),

  /** Nominal delta-v envelope (m/s); the compliance critic flags burns above it. */
  AGENT_MAX_DELTA_V_MS: z.coerce.number().positive().default(5),
  /**
   * Enable the similarity (semantic) memory layer: embed each proposal's
   * situation and surface similar past situations on new runs. Off by default —
   * on, it uses the offline deterministic lexical embedder (no API key, no cost).
   * See src/agents/embedder.ts for swapping in a model-backed embedder.
   */
  AGENT_SEMANTIC_MEMORY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Keys the audit chain's HMAC. The chain is only as trustworthy as this secret. */
  AUDIT_HMAC_KEY: z.string().min(1).default('dev-insecure-key-change-me'),

  /**
   * Optional LLM augmentation for the agent's "think" step. With no key the
   * agent runs a fully deterministic loop (no network) — the reasoning chain is
   * the source of truth either way (see ARCHITECTURE.md).
   */
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-3.5-sonnet'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(resolveSecretsFromFiles(process.env));

const DEV_HMAC_KEY = 'dev-insecure-key-change-me';

// The audit chain is only as trustworthy as its HMAC key. Refuse to boot in
// production with the publicly-known dev default or a weak key — otherwise anyone
// who read the source could forge a "valid" audit entry.
if (config.NODE_ENV === 'production') {
  if (config.AUDIT_HMAC_KEY === DEV_HMAC_KEY || config.AUDIT_HMAC_KEY.length < 32) {
    throw new Error(
      'AUDIT_HMAC_KEY must be a strong secret (>= 32 chars, not the dev default) in production. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
}
