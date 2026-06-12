import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { env } from '../env.js';

export interface TenantContext {
  id: string;
  code: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext;
  }
}

/**
 * Tenancy kernel (GEN-CFG-05): resolve the tenant for every request.
 * Resolution order: explicit `x-tenant` header (dev/API clients) → hostname → DEFAULT_TENANT.
 * Cached in-process; tenants change rarely.
 */
const cache = new Map<string, TenantContext>();

async function resolveTenant(req: FastifyRequest): Promise<TenantContext | undefined> {
  const headerCode = (req.headers['x-tenant'] as string | undefined)?.toLowerCase();
  const host = req.hostname?.toLowerCase();
  const key = headerCode ?? `host:${host}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let row;
  if (headerCode) {
    [row] = await db.select().from(schema.tenant).where(eq(schema.tenant.code, headerCode)).limit(1);
  } else if (host) {
    [row] = await db
      .select()
      .from(schema.tenant)
      .where(sql`${host} = ANY(${schema.tenant.hostnames})`)
      .limit(1);
  }
  if (!row) {
    [row] = await db.select().from(schema.tenant).where(eq(schema.tenant.code, env.DEFAULT_TENANT)).limit(1);
  }
  if (!row || !row.active) return undefined;
  const ctx: TenantContext = { id: row.id, code: row.code, name: row.name };
  cache.set(key, ctx);
  return ctx;
}

export default fp(async function tenantPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const tenant = await resolveTenant(req);
    if (!tenant) {
      return reply.code(421).send({ error: 'unknown_tenant', message: 'No tenant resolved for this request' });
    }
    req.tenant = tenant;
  });
});
