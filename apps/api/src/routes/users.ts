import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { writeAudit } from '../services/audit.js';

const roleAssignmentBody = z.object({
  role_id: z.string().uuid(),
  unit_id: z.string().uuid().nullable().optional(),
  valid_from: z.string().datetime().nullable().optional(),
  valid_to: z.string().datetime().nullable().optional(),
});

const createUserBody = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(120),
  password: z.string().min(8),
  active: z.boolean().default(true),
  roles: z.array(roleAssignmentBody).default([]),
});

const updateUserBody = z.object({
  display_name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

const setRolesBody = z.object({
  roles: z.array(roleAssignmentBody),
});

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v);
}

async function loadUserRoles(userId: string, tenantId: string) {
  return db
    .select({
      id: schema.userRole.id,
      roleId: schema.userRole.roleId,
      roleName: schema.role.name,
      unitId: schema.userRole.unitId,
      unitName: schema.unit.name,
      validFrom: schema.userRole.validFrom,
      validTo: schema.userRole.validTo,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
    .leftJoin(schema.unit, eq(schema.userRole.unitId, schema.unit.id))
    .where(and(eq(schema.userRole.userId, userId), eq(schema.role.tenantId, tenantId)));
}

function publicUser(row: typeof schema.appUser.$inferSelect, roles: Awaited<ReturnType<typeof loadUserRoles>>) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.displayName,
    active: row.active,
    created_at: row.createdAt,
    roles: roles.map((r) => ({
      id: r.id,
      role_id: r.roleId,
      role_name: r.roleName,
      unit_id: r.unitId,
      unit_name: r.unitName,
      valid_from: r.validFrom,
      valid_to: r.validTo,
    })),
  };
}

async function replaceUserRoles(
  tenantId: string,
  userId: string,
  roles: z.infer<typeof roleAssignmentBody>[],
) {
  for (const r of roles) {
    const [role] = await db
      .select({ id: schema.role.id })
      .from(schema.role)
      .where(and(eq(schema.role.id, r.role_id), eq(schema.role.tenantId, tenantId)))
      .limit(1);
    if (!role) throw new Error(`unknown_role:${r.role_id}`);
    if (r.unit_id) {
      const [unit] = await db
        .select({ id: schema.unit.id })
        .from(schema.unit)
        .where(and(eq(schema.unit.id, r.unit_id), eq(schema.unit.tenantId, tenantId)))
        .limit(1);
      if (!unit) throw new Error(`unknown_unit:${r.unit_id}`);
    }
  }

  await db.delete(schema.userRole).where(eq(schema.userRole.userId, userId));
  if (roles.length === 0) return;

  await db.insert(schema.userRole).values(
    roles.map((r) => ({
      userId,
      roleId: r.role_id,
      unitId: r.unit_id ?? null,
      validFrom: parseDate(r.valid_from),
      validTo: parseDate(r.valid_to),
    })),
  );
}

export default async function userRoutes(app: FastifyInstance) {
  app.get('/api/v1/users', { onRequest: [app.requirePermission('admin:users')] }, async (req) => {
    const users = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.tenantId, req.tenant.id))
      .orderBy(schema.appUser.displayName);

    const result = await Promise.all(
      users.map(async (u) => publicUser(u, await loadUserRoles(u.id, req.tenant.id))),
    );
    return { users: result };
  });

  app.get('/api/v1/users/:id', { onRequest: [app.requirePermission('admin:users')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.id, id)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return { user: publicUser(user, await loadUserRoles(user.id, req.tenant.id)) };
  });

  app.post('/api/v1/users', { onRequest: [app.requirePermission('admin:users')] }, async (req, reply) => {
    const parsed = createUserBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const email = parsed.data.email.toLowerCase();
    const [existing] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.email, email)))
      .limit(1);
    if (existing) return reply.code(409).send({ error: 'email_taken' });

    const [user] = await db
      .insert(schema.appUser)
      .values({
        tenantId: req.tenant.id,
        email,
        displayName: parsed.data.display_name,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        active: parsed.data.active,
      })
      .returning();

    try {
      await replaceUserRoles(req.tenant.id, user!.id, parsed.data.roles);
    } catch (e) {
      await db.delete(schema.appUser).where(eq(schema.appUser.id, user!.id));
      const msg = (e as Error).message;
      if (msg.startsWith('unknown_role:')) return reply.code(422).send({ error: 'unknown_role', role_id: msg.split(':')[1] });
      if (msg.startsWith('unknown_unit:')) return reply.code(422).send({ error: 'unknown_unit', unit_id: msg.split(':')[1] });
      throw e;
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'user.created',
      entity: 'app_user',
      entityId: user!.id,
      data: { email, roles: parsed.data.roles.length },
    });

    return reply.code(201).send({ user: publicUser(user!, await loadUserRoles(user!.id, req.tenant.id)) });
  });

  app.patch('/api/v1/users/:id', { onRequest: [app.requirePermission('admin:users')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateUserBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.id, id)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'not_found' });

    const patch: Partial<typeof schema.appUser.$inferInsert> = {};
    if (parsed.data.display_name != null) patch.displayName = parsed.data.display_name;
    if (parsed.data.active != null) patch.active = parsed.data.active;
    if (parsed.data.password) patch.passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const [updated] = await db.update(schema.appUser).set(patch).where(eq(schema.appUser.id, id)).returning();

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'user.updated',
      entity: 'app_user',
      entityId: id,
      data: { fields: Object.keys(parsed.data) },
    });

    return { user: publicUser(updated!, await loadUserRoles(id, req.tenant.id)) };
  });

  app.put('/api/v1/users/:id/roles', { onRequest: [app.requirePermission('admin:users')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = setRolesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const [user] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.id, id)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'not_found' });

    try {
      await replaceUserRoles(req.tenant.id, id, parsed.data.roles);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('unknown_role:')) return reply.code(422).send({ error: 'unknown_role', role_id: msg.split(':')[1] });
      if (msg.startsWith('unknown_unit:')) return reply.code(422).send({ error: 'unknown_unit', unit_id: msg.split(':')[1] });
      throw e;
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'user.roles_updated',
      entity: 'app_user',
      entityId: id,
      data: { count: parsed.data.roles.length },
    });

    const [full] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id)).limit(1);
    return { user: publicUser(full!, await loadUserRoles(id, req.tenant.id)) };
  });
}
