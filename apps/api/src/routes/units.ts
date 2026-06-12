import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd02Hierarchy } from '../types.js';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from '../services/config.js';
import { writeAudit } from '../services/audit.js';

const createBody = z.object({
  level_code: z.string().min(1),
  parent_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  code: z.string().min(1),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

/** Jurisdiction unit tree management (CD-02 instances; GEN-CFG-10). */
export default async function unitRoutes(app: FastifyInstance) {
  app.get('/api/v1/units', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req) => {
    const rows = await db
      .select()
      .from(schema.unit)
      .where(eq(schema.unit.tenantId, req.tenant.id))
      .orderBy(asc(schema.unit.name));
    return { units: rows };
  });

  app.post('/api/v1/units', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { level_code, parent_id, name, code } = parsed.data;

    const hierarchy = await getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy');
    if (!hierarchy) return reply.code(503).send({ error: 'hierarchy_not_configured' });
    const levelIdx = hierarchy.levels.findIndex((l) => l.code === level_code);
    if (levelIdx < 0) return reply.code(422).send({ error: 'unknown_level', details: { level_code } });

    // Parent must be exactly one level above (the next level in the ordered list).
    if (parent_id) {
      const [parent] = await db
        .select()
        .from(schema.unit)
        .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.id, parent_id)))
        .limit(1);
      if (!parent) return reply.code(422).send({ error: 'unknown_parent' });
      const parentIdx = hierarchy.levels.findIndex((l) => l.code === parent.levelCode);
      if (parentIdx !== levelIdx + 1) {
        return reply.code(422).send({
          error: 'invalid_parent_level',
          details: { expected_parent_level: hierarchy.levels[levelIdx + 1]?.code ?? null, got: parent.levelCode },
        });
      }
    } else if (levelIdx !== hierarchy.levels.length - 1) {
      return reply.code(422).send({ error: 'parent_required_below_top_level' });
    }

    try {
      const [created] = await db
        .insert(schema.unit)
        .values({ tenantId: req.tenant.id, levelCode: level_code, parentId: parent_id ?? null, name, code })
        .returning();
      await writeAudit({
        tenantId: req.tenant.id,
        actorId: req.user.sub,
        action: 'unit.created',
        entity: 'unit',
        entityId: created!.id,
        data: { name, code, level_code },
      });
      return reply.code(201).send({ unit: created });
    } catch (e: unknown) {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err.code === '23505' || err.cause?.code === '23505') {
        return reply.code(409).send({ error: 'duplicate_unit_code' });
      }
      throw e;
    }
  });

  app.patch('/api/v1/units/:id', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const [existing] = await db
      .select()
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.id, id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const [updated] = await db
      .update(schema.unit)
      .set({
        name: parsed.data.name ?? existing.name,
        code: parsed.data.code ?? existing.code,
        parentId: parsed.data.parent_id === undefined ? existing.parentId : parsed.data.parent_id,
        active: parsed.data.active ?? existing.active,
      })
      .where(eq(schema.unit.id, id))
      .returning();

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'unit.updated',
      entity: 'unit',
      entityId: id,
      data: { before: { name: existing.name, code: existing.code, active: existing.active }, after: parsed.data },
    });
    return { unit: updated };
  });
}
