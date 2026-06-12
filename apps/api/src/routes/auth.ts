import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { writeAudit } from '../services/audit.js';
import { loadUserAccess } from '../services/access.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.email, email.toLowerCase())))
      .limit(1);

    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      await writeAudit({ tenantId: req.tenant.id, action: 'auth.login_failed', entity: 'user', data: { email } });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const access = await loadUserAccess(user.id, req.tenant.id);
    const token = app.jwt.sign({
      sub: user.id,
      tenantId: req.tenant.id,
      email: user.email,
      name: user.displayName,
      permissions: access.permissions,
      tenantWide: access.tenantWide,
      jurisdictionRoots: access.jurisdictionRoots,
      sensitiveClasses: access.sensitiveClasses,
    });
    await writeAudit({ tenantId: req.tenant.id, actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.displayName,
        permissions: access.permissions,
        tenant_wide: access.tenantWide,
        jurisdiction_roots: access.jurisdictionRoots,
        sensitive_classes: access.sensitiveClasses,
        roles: access.assignments.map((a) => ({
          role_name: a.roleName,
          unit_id: a.unitId,
        })),
      },
    };
  });

  app.get('/api/v1/me', { onRequest: [app.authenticate] }, async (req) => {
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    return {
      user: {
        ...req.user,
        permissions: access.permissions,
        tenant_wide: access.tenantWide,
        jurisdiction_roots: access.jurisdictionRoots,
        sensitive_classes: access.sensitiveClasses,
        roles: access.assignments.map((a) => ({
          role_name: a.roleName,
          unit_id: a.unitId,
        })),
      },
      tenant: req.tenant,
    };
  });
}
