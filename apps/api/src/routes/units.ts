import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
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

const demoteBody = z.object({
  /** New parent (must sit at the unit's current level). */
  parent_id: z.string().uuid(),
});

type UnitRow = typeof schema.unit.$inferSelect;

/** Case-insensitive level lookup: admin-entered codes may differ in casing from stored unit rows. */
function levelIndexOf(hierarchy: Cd02Hierarchy, code: string): number {
  const needle = code.toLowerCase();
  return hierarchy.levels.findIndex((l) => l.code.toLowerCase() === needle);
}

/** All transitive descendants of a unit within a preloaded tenant unit list. */
function descendantsOf(all: UnitRow[], rootId: string): UnitRow[] {
  const out: UnitRow[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const u of all) {
      if (u.parentId === id) {
        out.push(u);
        queue.push(u.id);
      }
    }
  }
  return out;
}

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
    const levelIdx = levelIndexOf(hierarchy, level_code);
    if (levelIdx < 0) return reply.code(422).send({ error: 'unknown_level', details: { level_code } });

    // Parent must be exactly one level above (the next level in the ordered list).
    if (parent_id) {
      const [parent] = await db
        .select()
        .from(schema.unit)
        .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.id, parent_id)))
        .limit(1);
      if (!parent) return reply.code(422).send({ error: 'unknown_parent' });
      const parentIdx = levelIndexOf(hierarchy, parent.levelCode);
      if (parentIdx !== levelIdx + 1) {
        return reply.code(422).send({
          error: 'invalid_parent_level',
          details: { expected_parent_level: hierarchy.levels[levelIdx + 1]?.code ?? null, got: parent.levelCode },
        });
      }
    } else if (levelIdx !== hierarchy.levels.length - 1) {
      return reply.code(422).send({ error: 'parent_required_below_top_level' });
    } else {
      // Single-root rule: only one top-level unit may exist.
      const [root] = await db
        .select({ id: schema.unit.id })
        .from(schema.unit)
        .where(and(eq(schema.unit.tenantId, req.tenant.id), isNull(schema.unit.parentId)))
        .limit(1);
      if (root) return reply.code(422).send({ error: 'top_level_unit_exists' });
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

  /**
   * Promote a unit one level up (e.g. Settlement → County). The whole subtree
   * shifts up with it so parent/child levels stay adjacent. The new parent is
   * the former grandparent (null when promoting into the top level).
   */
  app.post('/api/v1/units/:id/promote', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hierarchy = await getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy');
    if (!hierarchy) return reply.code(503).send({ error: 'hierarchy_not_configured' });
    const levelIdx = (code: string) => levelIndexOf(hierarchy, code);

    const all = await db.select().from(schema.unit).where(eq(schema.unit.tenantId, req.tenant.id));
    const unit = all.find((u) => u.id === id);
    if (!unit) return reply.code(404).send({ error: 'not_found' });

    const idx = levelIdx(unit.levelCode);
    if (idx < 0) return reply.code(422).send({ error: 'unknown_level', details: { level_code: unit.levelCode } });
    if (idx >= hierarchy.levels.length - 1) return reply.code(422).send({ error: 'cannot_promote_top_level' });

    const parent = all.find((u) => u.id === unit.parentId);
    const newParentId = parent?.parentId ?? null;
    // Single-root rule: promoting into the top level would create a second root.
    if (newParentId === null && all.some((u) => u.parentId === null && u.id !== unit.id)) {
      return reply.code(422).send({ error: 'top_level_unit_exists' });
    }
    const subtree = descendantsOf(all, unit.id);
    const badLevel = subtree.find((d) => levelIdx(d.levelCode) < 0);
    if (badLevel) {
      return reply.code(422).send({ error: 'unknown_level', details: { unit: badLevel.id, level_code: badLevel.levelCode } });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.unit)
        .set({ levelCode: hierarchy.levels[idx + 1]!.code, parentId: newParentId })
        .where(eq(schema.unit.id, unit.id));
      for (const d of subtree) {
        const dIdx = levelIdx(d.levelCode);
        await tx.update(schema.unit).set({ levelCode: hierarchy.levels[dIdx + 1]!.code }).where(eq(schema.unit.id, d.id));
      }
    });

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'unit.promoted',
      entity: 'unit',
      entityId: unit.id,
      data: { from: unit.levelCode, to: hierarchy.levels[idx + 1]!.code, subtree_size: subtree.length },
    });
    return { ok: true };
  });

  /**
   * Demote a unit one level down (e.g. County → Settlement) under a new parent
   * at its former level. The subtree shifts down with it; rejected if any
   * descendant would fall below the lowest level.
   */
  app.post('/api/v1/units/:id/demote', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = demoteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const hierarchy = await getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy');
    if (!hierarchy) return reply.code(503).send({ error: 'hierarchy_not_configured' });
    const levelIdx = (code: string) => levelIndexOf(hierarchy, code);

    const all = await db.select().from(schema.unit).where(eq(schema.unit.tenantId, req.tenant.id));
    const unit = all.find((u) => u.id === id);
    if (!unit) return reply.code(404).send({ error: 'not_found' });

    const idx = levelIdx(unit.levelCode);
    if (idx < 0) return reply.code(422).send({ error: 'unknown_level', details: { level_code: unit.levelCode } });
    const subtree = descendantsOf(all, unit.id);
    const badLevel = subtree.find((d) => levelIdx(d.levelCode) < 0);
    if (badLevel) {
      return reply.code(422).send({ error: 'unknown_level', details: { unit: badLevel.id, level_code: badLevel.levelCode } });
    }
    const minIdx = Math.min(idx, ...subtree.map((d) => levelIdx(d.levelCode)));
    if (minIdx <= 0) {
      return reply.code(422).send({ error: 'cannot_demote_below_lowest_level' });
    }

    const parent = all.find((u) => u.id === parsed.data.parent_id);
    if (!parent) return reply.code(422).send({ error: 'unknown_parent' });
    if (parent.id === unit.id || subtree.some((d) => d.id === parent.id)) {
      return reply.code(422).send({ error: 'parent_inside_subtree' });
    }
    if (levelIdx(parent.levelCode) !== idx) {
      return reply.code(422).send({
        error: 'invalid_parent_level',
        details: { expected_parent_level: unit.levelCode, got: parent.levelCode },
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.unit)
        .set({ levelCode: hierarchy.levels[idx - 1]!.code, parentId: parent.id })
        .where(eq(schema.unit.id, unit.id));
      for (const d of subtree) {
        const dIdx = levelIdx(d.levelCode);
        await tx.update(schema.unit).set({ levelCode: hierarchy.levels[dIdx - 1]!.code }).where(eq(schema.unit.id, d.id));
      }
    });

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'unit.demoted',
      entity: 'unit',
      entityId: unit.id,
      data: { from: unit.levelCode, to: hierarchy.levels[idx - 1]!.code, new_parent: parent.id, subtree_size: subtree.length },
    });
    return { ok: true };
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

    // Single-root rule: re-parenting to null is only allowed if no other root exists.
    if (parsed.data.parent_id === null && existing.parentId !== null) {
      const [root] = await db
        .select({ id: schema.unit.id })
        .from(schema.unit)
        .where(and(eq(schema.unit.tenantId, req.tenant.id), isNull(schema.unit.parentId)))
        .limit(1);
      if (root && root.id !== id) return reply.code(422).send({ error: 'top_level_unit_exists' });
    }

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

  /**
   * Hard-delete a leaf unit. Only allowed when nothing depends on it:
   * no child units, no cases, no role assignments. Otherwise deactivate instead.
   */
  app.delete('/api/v1/units/:id', { onRequest: [app.requirePermission('admin:hierarchy')] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.id, id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const [child] = await db.select({ id: schema.unit.id }).from(schema.unit).where(eq(schema.unit.parentId, id)).limit(1);
    if (child) return reply.code(422).send({ error: 'has_children' });

    const [caseRow] = await db.select({ id: schema.grmCase.id }).from(schema.grmCase).where(eq(schema.grmCase.unitId, id)).limit(1);
    if (caseRow) return reply.code(422).send({ error: 'has_cases' });

    const [assignment] = await db.select({ id: schema.userRole.id }).from(schema.userRole).where(eq(schema.userRole.unitId, id)).limit(1);
    if (assignment) return reply.code(422).send({ error: 'has_role_assignments' });

    await db.delete(schema.unit).where(eq(schema.unit.id, id));

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'unit.deleted',
      entity: 'unit',
      entityId: id,
      data: { name: existing.name, code: existing.code, level_code: existing.levelCode },
    });
    return { ok: true };
  });
}
