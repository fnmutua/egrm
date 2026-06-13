import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { PERMISSION_GROUPS, PERMISSION_WILDCARDS } from '@egrm/core';
import { db, schema } from '../db/client.js';

export default async function roleRoutes(app: FastifyInstance) {
  app.get(
    '/api/v1/permissions',
    { onRequest: [app.authenticate] },
    async () => ({
      groups: PERMISSION_GROUPS,
      wildcards: PERMISSION_WILDCARDS,
    }),
  );

  app.get(
    '/api/v1/roles',
    { onRequest: [app.authenticate] },
    async (req) => {
      const rows = await db
        .select({
          id: schema.role.id,
          name: schema.role.name,
          label: schema.role.label,
          permissions: schema.role.permissions,
          mfaRequired: schema.role.mfaRequired,
        })
        .from(schema.role)
        .where(eq(schema.role.tenantId, req.tenant.id))
        .orderBy(schema.role.name);
      return { roles: rows };
    },
  );

  app.get(
    '/api/v1/roles/:name',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const [row] = await db
        .select()
        .from(schema.role)
        .where(and(eq(schema.role.tenantId, req.tenant.id), eq(schema.role.name, name)))
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'role_not_found' });
      return { role: row };
    },
  );
}
