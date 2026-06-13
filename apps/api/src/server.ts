// Load environment variables first before any other imports
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import tenantPlugin from './plugins/tenant.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import configRoutes from './routes/config.js';
import publicRoutes from './routes/public.js';
import caseRoutes from './routes/cases.js';
import unitRoutes from './routes/units.js';
import roleRoutes from './routes/roles.js';
import userRoutes from './routes/users.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
// Global ceiling; public routes carry stricter per-route limits (GEN-SEC-01).
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(tenantPlugin);
await app.register(authPlugin);

app.get('/health', async () => ({ status: 'ok', service: 'egrm-api' }));

await app.register(authRoutes);
await app.register(configRoutes);
await app.register(publicRoutes);
await app.register(caseRoutes);
await app.register(unitRoutes);
await app.register(roleRoutes);
await app.register(userRoutes);

try {
  console.log(`[server] starting on 0.0.0.0:${env.API_PORT}`);
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  console.log(`[server] listening on 0.0.0.0:${env.API_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
