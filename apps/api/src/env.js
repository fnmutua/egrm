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
    /** Public portal base URL for tracking links in notifications. */
    PUBLIC_PORTAL_BASE_URL: z.string().default('http://localhost:3000'),
    /** Log outbound messages to stdout instead of calling providers (local dev). */
    NOTIFICATIONS_DEV_LOG_ONLY: z
        .string()
        .optional()
        .transform((v) => v === '1' || v === 'true'),
    /** Dispatch notifications inline in the API process (no Redis worker required). */
    NOTIFICATIONS_SYNC_DISPATCH: z
        .string()
        .optional()
        .transform((v) => v === '1' || v === 'true'),
});
const parsed = envSchema.parse(process.env);
export const env = {
    ...parsed,
    API_PORT: parsed.PORT ?? parsed.API_PORT ?? 4100,
    NOTIFICATIONS_DEV_LOG_ONLY: parsed.NOTIFICATIONS_DEV_LOG_ONLY ?? false,
    NOTIFICATIONS_SYNC_DISPATCH: parsed.NOTIFICATIONS_SYNC_DISPATCH ?? false,
};
//# sourceMappingURL=env.js.map