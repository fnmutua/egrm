import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { canManageTargetRole, manageableRoleNames, PERMISSION_GROUPS, PERMISSION_WILDCARDS } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { loadUserAccess } from '../services/access.js';
import { getRoleCatalog } from '../services/role-hierarchy.js';

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
      const q = req.query as { manageable?: string };
      const catalog = await getRoleCatalog(req.tenant.id);
      const catalogByName = new Map(catalog.map((r) => [r.name, r]));

      const rows = await db
        .select({
          id: schema.role.id,
          name: schema.role.name,
          label: schema.role.label,
          permissions: schema.role.permissions,
          mfaRequired: schema.role.mfaRequired,
          parentRoleName: schema.role.parentRoleName,
        })
        .from(schema.role)
        .where(eq(schema.role.tenantId, req.tenant.id))
        .orderBy(schema.role.name);

      let manageable: Set<string> | null = null;
      if (q.manageable === '1' || q.manageable === 'true') {
        const access = await loadUserAccess(req.user.sub, req.tenant.id);
        if (access.permissions.includes('admin:*')) {
          manageable = new Set(rows.map((r) => r.name));
        } else {
          manageable = manageableRoleNames(
            access.assignments.map((a) => a.roleName),
            catalog,
          );
        }
      }

      const roles = rows
        .filter((row) => !manageable || manageable.has(row.name))
        .map((row) => ({
          id: row.id,
          name: row.name,
          label: row.label,
          permissions: row.permissions,
          mfa_required: row.mfaRequired,
          parent_role: row.parentRoleName ?? catalogByName.get(row.name)?.parent_role ?? null,
        }));

      return { roles };
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

      const catalog = await getRoleCatalog(req.tenant.id);
      const access = await loadUserAccess(req.user.sub, req.tenant.id);
      const manageable = canManageTargetRole(
        access.assignments.map((a) => a.roleName),
        access.permissions,
        name,
        catalog,
      );

      return {
        role: {
          ...row,
          parent_role: row.parentRoleName ?? catalog.find((r) => r.name === name)?.parent_role ?? null,
          manageable,
        },
      };
    },
  );
}
