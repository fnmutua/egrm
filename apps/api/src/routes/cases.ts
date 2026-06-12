import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { decryptPII } from '../services/crypto.js';
import { createCase } from '../services/intake.js';
import { writeAudit } from '../services/audit.js';
import { canAccessCase, caseVisibilityFilter, sensitivityListFilter } from '../services/access.js';

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const assistedBody = z.object({
  anonymous: z.boolean().default(false),
  consent: z.boolean().default(false),
  source_channel: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
});

/** Staff case endpoints with jurisdiction-subtree scoping (spec 07 §2.2). */
export default async function caseRoutes(app: FastifyInstance) {
  app.get('/api/v1/cases', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { status, q, page, page_size } = parsed.data;

    const scopeFilter = await caseVisibilityFilter(req.tenant.id, req.user, req.user.sub);
    const sensitivityFilter = sensitivityListFilter(req.user, req.user.sub);

    const where = and(
      eq(schema.grmCase.tenantId, req.tenant.id),
      status ? eq(schema.grmCase.status, status) : undefined,
      q ? or(ilike(schema.grmCase.reference, `%${q}%`), ilike(schema.grmCase.summary, `%${q}%`)) : undefined,
      scopeFilter,
      sensitivityFilter,
    );

    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: schema.grmCase.id,
          reference: schema.grmCase.reference,
          status: schema.grmCase.status,
          statusTag: schema.grmCase.statusTag,
          levelCode: schema.grmCase.levelCode,
          categories: schema.grmCase.categories,
          summary: schema.grmCase.summary,
          channel: schema.grmCase.channel,
          anonymous: schema.grmCase.anonymous,
          priority: schema.grmCase.priority,
          sensitivity: schema.grmCase.sensitivity,
          createdAt: schema.grmCase.createdAt,
          unitName: schema.unit.name,
        })
        .from(schema.grmCase)
        .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
        .where(where)
        .orderBy(desc(schema.grmCase.createdAt))
        .limit(page_size)
        .offset((page - 1) * page_size),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.grmCase).where(where),
    ]);

    return { cases: rows, total: count?.n ?? 0, page, page_size };
  });

  app.get('/api/v1/cases/:id', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db
      .select()
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });

    const allowed = await canAccessCase(req.tenant.id, req.user, req.user.sub, {
      unitId: c.unitId,
      assigneeId: c.assigneeId,
      sensitivity: c.sensitivity,
    });
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    let complainant = null;
    if (c.partyId && hasPermission(req.user.permissions, 'case:read')) {
      const [p] = await db.select().from(schema.party).where(eq(schema.party.id, c.partyId)).limit(1);
      if (p) {
        complainant = {
          name: decryptPII(p.nameEnc),
          phone: decryptPII(p.phoneEnc),
          email: decryptPII(p.emailEnc),
          gender: p.gender,
          age_band: p.ageBand,
          preferred_language: p.preferredLanguage,
        };
        await writeAudit({
          tenantId: req.tenant.id,
          actorId: req.user.sub,
          action: 'case.pii_viewed',
          entity: 'grm_case',
          entityId: c.id,
        });
      }
    }

    const events = await db
      .select()
      .from(schema.caseEvent)
      .where(eq(schema.caseEvent.caseId, c.id))
      .orderBy(asc(schema.caseEvent.createdAt));

    let unitName: string | null = null;
    if (c.unitId) {
      const [u] = await db.select({ name: schema.unit.name }).from(schema.unit).where(eq(schema.unit.id, c.unitId)).limit(1);
      unitName = u?.name ?? null;
    }

    return {
      case: {
        id: c.id,
        reference: c.reference,
        case_type: c.caseType,
        status: c.status,
        status_tag: c.statusTag,
        level: c.levelCode,
        unit: unitName,
        anonymous: c.anonymous,
        channel: c.channel,
        categories: c.categories,
        sensitivity: c.sensitivity,
        priority: c.priority,
        summary: c.summary,
        description: c.description,
        expected_outcome: c.expectedOutcome,
        date_occurred: c.dateOccurred,
        consent: c.consent,
        created_at: c.createdAt,
      },
      complainant,
      events,
    };
  });

  app.get('/api/v1/cases/:id/notifications', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db
      .select({
        id: schema.grmCase.id,
        unitId: schema.grmCase.unitId,
        assigneeId: schema.grmCase.assigneeId,
        sensitivity: schema.grmCase.sensitivity,
      })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });

    const allowed = await canAccessCase(req.tenant.id, req.user, req.user.sub, {
      unitId: c.unitId,
      assigneeId: c.assigneeId,
      sensitivity: c.sensitivity,
    });
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    const rows = await db
      .select({
        id: schema.notificationLog.id,
        eventKind: schema.notificationLog.eventKind,
        ruleId: schema.notificationLog.ruleId,
        recipientKind: schema.notificationLog.recipientKind,
        channel: schema.notificationLog.channel,
        templateId: schema.notificationLog.templateId,
        locale: schema.notificationLog.locale,
        status: schema.notificationLog.status,
        renderedPreview: schema.notificationLog.renderedPreview,
        providerMessageId: schema.notificationLog.providerMessageId,
        attempts: schema.notificationLog.attempts,
        createdAt: schema.notificationLog.createdAt,
        updatedAt: schema.notificationLog.updatedAt,
      })
      .from(schema.notificationLog)
      .where(and(eq(schema.notificationLog.tenantId, req.tenant.id), eq(schema.notificationLog.caseId, id)))
      .orderBy(desc(schema.notificationLog.createdAt));

    return {
      notifications: rows.map((r) => ({
        id: r.id,
        event_kind: r.eventKind,
        rule_id: r.ruleId,
        recipient_kind: r.recipientKind,
        channel: r.channel,
        template_id: r.templateId,
        locale: r.locale,
        status: r.status,
        rendered_preview: r.renderedPreview,
        provider_message_id: r.providerMessageId,
        attempts: r.attempts,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
    };
  });

  app.post('/api/v1/cases', { onRequest: [app.requirePermission('case:create_assisted')] }, async (req, reply) => {
    const parsed = assistedBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const result = await createCase({
      tenantId: req.tenant.id,
      channel: parsed.data.source_channel,
      anonymous: parsed.data.anonymous,
      consent: parsed.data.consent,
      values: parsed.data.values,
      staffActorId: req.user.sub,
    });
    if (!result.ok) return reply.code(result.code).send({ error: result.error, details: result.details });

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'case.created_assisted',
      entity: 'grm_case',
      entityId: result.caseId,
      data: { reference: result.reference, channel: parsed.data.source_channel },
    });
    return reply.code(201).send({
      reference: result.reference,
      status: result.status,
      tracking_pin: result.trackingPin,
      possible_duplicates: result.possibleDuplicates,
    });
  });
}
