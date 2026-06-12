import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/egrm'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-only-secret'),
  PII_SECRET: z.string().default('dev-only-pii-secret'),
  API_PORT: z.coerce.number().default(4100),
  DEFAULT_TENANT: z.string().default('kisip'),
});

export const env = envSchema.parse(process.env);
