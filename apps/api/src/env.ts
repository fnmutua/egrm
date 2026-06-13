import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Railway CLI injects env before the process starts — do not load local apps/api/.env on top.
if (!process.env.RAILWAY_PROJECT_ID) {
  loadDotenv();
}
import { resolveDatabaseUrl } from './db/resolve-database-url.js';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/egrm'),
  JWT_SECRET: z.string().default('dev-only-secret'),
  PII_SECRET: z.string().default('dev-only-pii-secret'),
  /** Railway injects PORT; API_PORT kept for local dev. */
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().optional(),
  DEFAULT_TENANT: z.string().default('kisip'),
  /** Comma-separated hostnames added to the seeded tenant (Railway public URLs). */
  SEED_TENANT_HOSTNAMES: z.string().optional(),
  /** Run seed during deploy bootstrap: 1=always, 0=never, unset=only when DB has no tenants. */
  SEED_ON_DEPLOY: z.string().optional(),
  /** Public portal base URL for tracking links in notifications. */
  PUBLIC_PORTAL_BASE_URL: z.string().default('http://localhost:3000'),
  /** Log outbound messages to stdout instead of calling providers (local dev). */
  NOTIFICATIONS_DEV_LOG_ONLY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  DATABASE_URL: resolveDatabaseUrl(parsed.DATABASE_URL),
  API_PORT: parsed.PORT ?? parsed.API_PORT ?? 4100,
  NOTIFICATIONS_DEV_LOG_ONLY: parsed.NOTIFICATIONS_DEV_LOG_ONLY ?? false,
};
