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
  /** Keys the audit chain's HMAC. The chain is only as trustworthy as this secret. */
  AUDIT_HMAC_KEY: z.string().min(1).default('dev-insecure-key-change-me'),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);
