import { z } from 'zod';

/**
 * All runtime configuration comes from the environment, validated once at boot.
 * Sane local defaults keep `git clone && npm i && npm run dev` working with no
 * setup; every value is overridable via a gitignored `.env` (see .env.example).
 */
const EnvSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65535).default(8790),
  DATA_DIR: z.string().default('./.data/pgdata'),
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

export const config: Config = EnvSchema.parse(process.env);

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
