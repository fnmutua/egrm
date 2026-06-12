import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { writeAudit } from '../services/audit.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function loadPermissions(userId: string): Promise<string[]> {
  const assignments = await db
    .select({ roleId: schema.userRole.roleId, validTo: schema.userRole.validTo, validFrom: schema.userRole.validFrom })
    .from(schema.userRole)
    .where(eq(schema.userRole.userId, userId));
  const now = new Date();
  const activeRoleIds = assignments
    .filter((a) => (!a.validFrom || a.validFrom <= now) && (!a.validTo || a.validTo >= now))
    .map((a) => a.roleId);
  if (activeRoleIds.length === 0) return [];
  const roles = await db.select().from(schema.role).where(inArray(schema.role.id, activeRoleIds));
  return [...new Set(roles.flatMap((r) => r.permissions))];
}

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

    const permissions = await loadPermissions(user.id);
    const token = app.jwt.sign({
      sub: user.id,
      tenantId: req.tenant.id,
      email: user.email,
      name: user.displayName,
      permissions,
    });
    await writeAudit({ tenantId: req.tenant.id, actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return { token, user: { id: user.id, email: user.email, name: user.displayName, permissions } };
  });

  app.get('/api/v1/me', { onRequest: [app.authenticate] }, async (req) => {
    return { user: req.user, tenant: req.tenant };
  });
}
