import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/egrm'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-only-secret'),
  PII_SECRET: z.string().default('dev-only-pii-secret'),
  /** Railway injects PORT; API_PORT kept for local dev. */
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().optional(),
  DEFAULT_TENANT: z.string().default('kisip'),
  /** Comma-separated hostnames added to the seeded tenant (Railway public URLs). */
  SEED_TENANT_HOSTNAMES: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  API_PORT: parsed.PORT ?? parsed.API_PORT ?? 4100,
};
