import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { decryptPII } from '../services/crypto.js';
import { createCase } from '../services/intake.js';
import { writeAudit } from '../services/audit.js';
import {
  canAccessCase,
  canAccessCaseForTriageReview,
  canFilterCasesByUnit,
  canScopeCasesToRoot,
  caseUnitSubtreeFilter,
  caseVisibilityFilter,
  expandUnitSubtrees,
  loadUserAccess,
  sensitivityListFilter,
} from '../services/access.js';
import { applyCaseAction, getAvailableCaseActions } from '../services/case-workflow.js';
import { decideAppealAction, listCaseAppeals } from '../services/appeals.js';
import { unitSelfAndAncestors } from '../services/units.js';
import {
  commitStandaloneAttachments,
  deleteStagedAttachment,
  getAttachmentDownload,
  listCaseAttachments,
  renameActiveAttachment,
  softDeleteActiveAttachment,
  stageCaseAttachment,
} from '../services/attachments.js';
import { createStaffThreadMessage, listCaseThread } from '../services/correspondence.js';
import { clearSeedCases, countSeedCases, seedCases } from '../services/seed-cases.js';
import { getCaseFieldOptions, updateCaseFields } from '../services/case-fields.js';
import { getComplainantFieldOptions, updateCaseComplainant } from '../services/case-complainant.js';
import multipart from '@fastify/multipart';
import { coerceIntakeString } from '../services/intake-values.js';

function coerceSourceChannel(raw: unknown): string {
  const direct = coerceIntakeString(raw);
  if (direct) return direct;
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return coerceIntakeString((raw as { value: unknown }).value) ?? '';
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  unit_id: z.string().uuid().optional(),
  /** Narrow jurisdiction visibility to one assigned root (not a unit subtree drill-down). */
  scope_root: z.string().uuid().optional(),
  /** Filter to cases currently assigned to this officer. */
  assignee_id: z.string().uuid().optional(),
  /** jurisdiction = in my area(s); assigned = my assignee queue; union = both (nav counts). */
  view: z.enum(['jurisdiction', 'assigned', 'union']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const assistedBody = z.object({
  anonymous: z.boolean().default(false),
  consent: z.boolean().default(false),
  source_channel: z.unknown().transform(coerceSourceChannel).pipe(z.string().min(1, 'source_channel_required')),
  values: z.record(z.string(), z.unknown()),
});

const caseActionBody = z.object({
  action: z.enum(['transition', 'assign']),
  to_status: z.string().min(1).optional(),
  assignee_id: z.string().uuid().optional(),
  note: z.string().optional(),
  action_taken: z.string().optional(),
  update_summary: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  attachment_ids: z.array(z.string().uuid()).optional(),
});

const commitAttachmentsBody = z.object({
  attachment_ids: z.array(z.string().uuid()).min(1),
  note: z.string().optional(),
});

const patchAttachmentBody = z.object({
  filename: z.string().min(1).max(255),
});

const threadBody = z.object({
  body: z.string().min(1),
  internal: z.boolean().optional(),
  message_kind: z.string().optional(),
  channel: z.string().optional(),
  visibility: z.enum(['public', 'staff']).optional(),
  attachment_ids: z.array(z.string().uuid()).optional(),
  in_reply_to_id: z.string().uuid().optional(),
});

const seedCasesBody = z.object({
  count: z.coerce.number().int().min(1).max(500).default(50),
});

/** Staff case endpoints with jurisdiction-subtree scoping (spec 07 §2.2). */
export default async function caseRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  app.get('/api/v1/cases/filter-units', { onRequest: [app.requirePermission('case:read')] }, async (req) => {
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const allowedIds = access.tenantWide
      ? (await db
          .select({ id: schema.unit.id })
          .from(schema.unit)
          .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.active, true))))
          .map((u) => u.id)
      : [...(await expandUnitSubtrees(req.tenant.id, access.jurisdictionRoots))];

    if (allowedIds.length === 0) {
      return { tenant_wide: access.tenantWide, units: [], jurisdiction_roots: [], default_unit_id: null };
    }

    const units = await db
      .select({
        id: schema.unit.id,
        name: schema.unit.name,
        levelCode: schema.unit.levelCode,
      })
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, req.tenant.id), inArray(schema.unit.id, allowedIds), eq(schema.unit.active, true)))
      .orderBy(asc(schema.unit.name));

    const rootIds = access.tenantWide ? [] : [...new Set(access.jurisdictionRoots)];
    const jurisdictionRoots =
      rootIds.length > 0
        ? (
            await db
              .select({
                id: schema.unit.id,
                name: schema.unit.name,
                levelCode: schema.unit.levelCode,
              })
              .from(schema.unit)
              .where(
                and(
                  eq(schema.unit.tenantId, req.tenant.id),
                  inArray(schema.unit.id, rootIds),
                  eq(schema.unit.active, true),
                ),
              )
              .orderBy(asc(schema.unit.name))
          ).map((u) => ({ id: u.id, name: u.name, level_code: u.levelCode }))
        : [];

    const defaultUnitId =
      !access.tenantWide && jurisdictionRoots.length > 0 ? jurisdictionRoots[0]!.id : null;

    return {
      tenant_wide: access.tenantWide,
      units: units.map((u) => ({ id: u.id, name: u.name, level_code: u.levelCode })),
      jurisdiction_roots: jurisdictionRoots,
      default_unit_id: defaultUnitId,
    };
  });

  app.get('/api/v1/cases', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { status, q, unit_id, scope_root, assignee_id, view, page, page_size } = parsed.data;

    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const listView = assignee_id ? 'jurisdiction' : (view ?? 'jurisdiction');
    const geographicView = !assignee_id && listView !== 'assigned';

    if (geographicView && scope_root && !canScopeCasesToRoot(access, scope_root)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Jurisdiction outside your scope' });
    }
    if (geographicView && unit_id) {
      const allowed = await canFilterCasesByUnit(req.tenant.id, access, unit_id);
      if (!allowed) return reply.code(403).send({ error: 'forbidden', message: 'Unit outside your jurisdiction scope' });
    }

    const scopeFilter = await caseVisibilityFilter(
      req.tenant.id,
      access,
      req.user.sub,
      geographicView && scope_root ? [scope_root] : undefined,
      assignee_id ? 'jurisdiction' : listView,
    );
    const sensitivityFilter = sensitivityListFilter(access, req.user.sub);
    const unitFilter =
      geographicView && unit_id ? await caseUnitSubtreeFilter(req.tenant.id, unit_id) : undefined;

    const where = and(
      eq(schema.grmCase.tenantId, req.tenant.id),
      status ? eq(schema.grmCase.status, status) : undefined,
      q ? or(ilike(schema.grmCase.reference, `%${q}%`), ilike(schema.grmCase.summary, `%${q}%`)) : undefined,
      assignee_id ? eq(schema.grmCase.assigneeId, assignee_id) : undefined,
      scopeFilter,
      sensitivityFilter,
      unitFilter,
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

  app.get('/api/v1/cases/field-options', { onRequest: [app.requirePermission('case:edit_fields')] }, async (req, reply) => {
    const [options, complainant] = await Promise.all([
      getCaseFieldOptions(req.tenant.id),
      getComplainantFieldOptions(req.tenant.id),
    ]);
    if (!options) return reply.code(503).send({ error: 'tenant_not_configured' });
    return { options: { ...options, complainant: complainant ?? { gender: [], age_band: [], preferred_language: [], notification_channels: [] } } };
  });

  app.get('/api/v1/cases/seed/count', { onRequest: [app.requireAdminConsole] }, async (req) => {
    const count = await countSeedCases(req.tenant.id);
    return { count };
  });

  app.post('/api/v1/cases/seed', { onRequest: [app.requireAdminConsole] }, async (req, reply) => {
    const parsed = seedCasesBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    try {
      const result = await seedCases(req.tenant.id, parsed.data.count, req.user.sub);
      await writeAudit({
        tenantId: req.tenant.id,
        actorId: req.user.sub,
        action: 'case.seed',
        entity: 'grm_case',
        entityId: req.tenant.id,
        data: result,
      });
      return reply.code(201).send({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'seed_failed';
      return reply.code(503).send({ error: message });
    }
  });

  app.post('/api/v1/cases/seed/clear', { onRequest: [app.requireAdminConsole] }, async (req, reply) => {
    try {
      const result = await clearSeedCases(req.tenant.id);
      await writeAudit({
        tenantId: req.tenant.id,
        actorId: req.user.sub,
        action: 'case.seed_clear',
        entity: 'grm_case',
        entityId: req.tenant.id,
        data: result,
      });
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'seed_clear_failed';
      return reply.code(500).send({ error: 'seed_clear_failed', message });
    }
  });

  app.get('/api/v1/cases/:id', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db
      .select()
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });

    const allowed = await canAccessCaseForTriageReview(req.tenant.id, req.user, req.user.sub, id, {
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
          notification_channels: p.notificationChannels ?? [],
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

    let assignee: { id: string; name: string; email: string } | null = null;
    if (c.assigneeId) {
      const [u] = await db
        .select({ id: schema.appUser.id, name: schema.appUser.displayName, email: schema.appUser.email })
        .from(schema.appUser)
        .where(eq(schema.appUser.id, c.assigneeId))
        .limit(1);
      if (u) assignee = { id: u.id, name: u.name, email: u.email };
    }

    return {
      case: {
        id: c.id,
        reference: c.reference,
        case_type: c.caseType,
        status: c.status,
        status_tag: c.statusTag,
        level: c.levelCode,
        unit_id: c.unitId,
        unit: unitName,
        assignee,
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
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actorType: e.actorType,
        visibility: e.visibility,
        data: (e.data ?? {}) as Record<string, unknown>,
        createdAt: e.createdAt,
      })),
    };
  });

  app.patch('/api/v1/cases/:id/fields', { onRequest: [app.requirePermission('case:edit_fields')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await updateCaseFields(req.tenant.id, id, req.user.sub, access, req.body);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }
    return { case: result.case };
  });

  app.patch('/api/v1/cases/:id/complainant', { onRequest: [app.requirePermission('case:edit_fields')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await updateCaseComplainant(req.tenant.id, id, req.user.sub, access, req.body);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }
    return { complainant: result.complainant };
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
        lastError: schema.notificationLog.lastError,
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
        last_error: r.lastError,
        attempts: r.attempts,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
    };
  });

  app.get('/api/v1/cases/:id/available-actions', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await getAvailableCaseActions(req.tenant.id, id, access, req.user.sub);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    return { actions: result };
  });

  app.get('/api/v1/cases/:id/appeals', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db
      .select({
        unitId: schema.grmCase.unitId,
        assigneeId: schema.grmCase.assigneeId,
        sensitivity: schema.grmCase.sensitivity,
      })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });

    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const allowed = await canAccessCase(req.tenant.id, access, req.user.sub, c);
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    const appeals = await listCaseAppeals(req.tenant.id, id);
    return { appeals };
  });

  const appealDecideBody = z.object({
    decision: z.enum(['uphold', 'dismiss']),
    note: z.string().max(4000).optional(),
  });

  app.post('/api/v1/cases/:id/appeals/:aid/decide', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id, aid } = req.params as { id: string; aid: string };
    const parsed = appealDecideBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await decideAppealAction(
      req.tenant.id,
      id,
      aid,
      req.user.sub,
      access,
      parsed.data,
    );
    if (!result.ok) return reply.code(result.code).send({ error: result.error, message: result.message });
    return { ok: true };
  });

  app.get('/api/v1/cases/:id/assignees', { onRequest: [app.requirePermission('case:assign')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db
      .select({ unitId: schema.grmCase.unitId, assigneeId: schema.grmCase.assigneeId, sensitivity: schema.grmCase.sensitivity })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });

    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const allowed = await canAccessCase(req.tenant.id, access, req.user.sub, c);
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    const jurisdictionUnitIds = await unitSelfAndAncestors(req.tenant.id, c.unitId);
    const jurisdictionSet = new Set(jurisdictionUnitIds);

    const roleRows = await db
      .select({
        userId: schema.userRole.userId,
        unitId: schema.userRole.unitId,
      })
      .from(schema.userRole)
      .innerJoin(schema.appUser, eq(schema.userRole.userId, schema.appUser.id))
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.active, true)));

    const eligibleUserIds = new Set<string>();
    const atCaseUnit = new Set<string>();
    for (const row of roleRows) {
      if (row.unitId === null || jurisdictionSet.has(row.unitId)) {
        eligibleUserIds.add(row.userId);
        if (c.unitId && row.unitId === c.unitId) atCaseUnit.add(row.userId);
      }
    }

    if (eligibleUserIds.size === 0 && !c.unitId) {
      const allActive = await db
        .select({ id: schema.appUser.id })
        .from(schema.appUser)
        .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.active, true)));
      for (const u of allActive) eligibleUserIds.add(u.id);
    }

    const users = await db
      .select({
        id: schema.appUser.id,
        name: schema.appUser.displayName,
        email: schema.appUser.email,
      })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.active, true)))
      .orderBy(schema.appUser.displayName);

    const filtered = users.filter((u) => eligibleUserIds.has(u.id));
    const suggested =
      !c.assigneeId && c.unitId
        ? filtered.find((u) => atCaseUnit.has(u.id))?.id ?? null
        : null;

    return {
      assignees: filtered.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      suggested_assignee_id: suggested,
    };
  });

  app.get('/api/v1/cases/:id/attachments', { onRequest: [app.requirePermission('case:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const attachments = await listCaseAttachments(req.tenant.id, id, access, req.user.sub);
    return { attachments };
  });

  app.post('/api/v1/cases/:id/attachments/stage', { onRequest: [app.requirePermission('attachment:upload')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const [c] = await db
      .select({ unitId: schema.grmCase.unitId, assigneeId: schema.grmCase.assigneeId, sensitivity: schema.grmCase.sensitivity })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const allowed = await canAccessCase(req.tenant.id, access, req.user.sub, c);
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    let fileBuffer: Buffer | null = null;
    let filename = '';
    let mime = 'application/octet-stream';
    let kind = 'evidence';

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename || 'upload';
        mime = part.mimetype || mime;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === 'kind') {
        kind = String(part.value);
      }
    }

    if (!fileBuffer || !filename) return reply.code(400).send({ error: 'file_required' });

    const result = await stageCaseAttachment({
      tenantId: req.tenant.id,
      caseId: id,
      actorId: req.user.sub,
      kind,
      filename,
      mime,
      data: fileBuffer,
    });
    if ('error' in result) {
      return reply.code(422).send({ error: result.error, message: result.message });
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'attachment.staged',
      entity: 'case_attachment',
      entityId: result.id,
      data: { case_id: id, kind, filename },
    });

    return { attachment_id: result.id, status: 'staging' };
  });

  app.post('/api/v1/cases/:id/attachments', { onRequest: [app.requirePermission('attachment:upload')] }, async (req, reply) => {
    const parsed = commitAttachmentsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const [c] = await db
      .select({ unitId: schema.grmCase.unitId, assigneeId: schema.grmCase.assigneeId, sensitivity: schema.grmCase.sensitivity })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, id)))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const allowed = await canAccessCase(req.tenant.id, access, req.user.sub, c);
    if (!allowed) return reply.code(404).send({ error: 'not_found' });

    try {
      const result = await commitStandaloneAttachments({
        tenantId: req.tenant.id,
        caseId: id,
        actorId: req.user.sub,
        attachmentIds: parsed.data.attachment_ids,
        note: parsed.data.note,
      });
      if ('error' in result) return reply.code(result.code).send({ error: result.error, message: result.message });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'commit_failed';
      return reply.code(422).send({ error: msg });
    }

    return { ok: true };
  });

  app.get('/api/v1/cases/:id/attachments/:aid/download', { onRequest: [app.requirePermission('attachment:download')] }, async (req, reply) => {
    const { id, aid } = req.params as { id: string; aid: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await getAttachmentDownload(req.tenant.id, id, aid, access, req.user.sub);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'attachment.downloaded',
      entity: 'case_attachment',
      entityId: aid,
      data: { case_id: id },
    });

    return reply
      .header('Content-Type', result.mime)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
      .send(result.data);
  });

  app.patch('/api/v1/cases/:id/attachments/:aid', { onRequest: [app.requirePermission('attachment:rename')] }, async (req, reply) => {
    const parsed = patchAttachmentBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { id, aid } = req.params as { id: string; aid: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await renameActiveAttachment(
      req.tenant.id,
      id,
      aid,
      access,
      req.user.sub,
      parsed.data.filename,
    );
    if ('error' in result) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'attachment.renamed',
      entity: 'case_attachment',
      entityId: aid,
      data: { case_id: id, filename: result.filename },
    });

    return { ok: true, filename: result.filename };
  });

  app.delete('/api/v1/cases/:id/attachments/:aid', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id, aid } = req.params as { id: string; aid: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const perms = req.user.permissions;
    const canDelete = hasPermission(perms, 'attachment:delete_soft');
    const canUpload = hasPermission(perms, 'attachment:upload');

    const [row] = await db
      .select({ status: schema.caseAttachment.status })
      .from(schema.caseAttachment)
      .where(
        and(
          eq(schema.caseAttachment.tenantId, req.tenant.id),
          eq(schema.caseAttachment.caseId, id),
          eq(schema.caseAttachment.id, aid),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    if (row.status === 'staging') {
      if (!canUpload && !canDelete) {
        return reply.code(403).send({ error: 'forbidden', required: 'attachment:upload' });
      }
      const result = await deleteStagedAttachment(req.tenant.id, id, aid, req.user.sub, {
        allowOtherUploader: canDelete,
      });
      if ('error' in result) return reply.code(result.code).send({ error: result.error });
      return { ok: true };
    }

    if (row.status === 'active') {
      if (!canDelete) {
        return reply.code(403).send({ error: 'forbidden', required: 'attachment:delete_soft' });
      }
      const result = await softDeleteActiveAttachment(req.tenant.id, id, aid, access, req.user.sub);
      if ('error' in result) return reply.code(result.code).send({ error: result.error });

      await writeAudit({
        tenantId: req.tenant.id,
        actorId: req.user.sub,
        action: 'attachment.deleted',
        entity: 'case_attachment',
        entityId: aid,
        data: { case_id: id, filename: result.filename },
      });

      return { ok: true };
    }

    return reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/v1/cases/:id/actions', { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = caseActionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const perm = parsed.data.action === 'assign' ? 'case:assign' : 'case:transition';
    if (!hasPermission(req.user.permissions, perm)) {
      return reply.code(403).send({ error: 'forbidden', required: perm });
    }

    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await applyCaseAction(req.tenant.id, id, req.user.sub, access, parsed.data);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: parsed.data.action === 'assign' ? 'case.assigned' : 'case.transitioned',
      entity: 'grm_case',
      entityId: id,
      data: { to_status: parsed.data.to_status, assignee_id: parsed.data.assignee_id },
    });

    return result;
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
    if (!result.ok) {
      return reply.code(result.code).send({
        error: result.error,
        message: result.message,
        details: result.details,
      });
    }

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: 'case.created_assisted',
      entity: 'grm_case',
      entityId: result.caseId,
      data: { reference: result.reference, channel: parsed.data.source_channel },
    });
    return reply.code(201).send({
      case_id: result.caseId,
      reference: result.reference,
      status: result.status,
      tracking_pin: result.trackingPin,
      possible_duplicates: result.possibleDuplicates,
    });
  });

  app.get('/api/v1/cases/:id/thread', { onRequest: [app.requirePermission('thread:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await listCaseThread(req.tenant.id, id, access, req.user.sub);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    return { entries: result };
  });

  app.post('/api/v1/cases/:id/thread', { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = threadBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const perm = parsed.data.internal ? 'thread:note_internal' : 'thread:reply_external';
    if (!hasPermission(req.user.permissions, perm)) {
      return reply.code(403).send({ error: 'forbidden', required: perm });
    }

    const { id } = req.params as { id: string };
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    const result = await createStaffThreadMessage({
      tenantId: req.tenant.id,
      caseId: id,
      actorId: req.user.sub,
      access,
      body: parsed.data.body,
      internal: parsed.data.internal,
      messageKind: parsed.data.message_kind,
      channel: parsed.data.channel,
      visibility: parsed.data.visibility,
      attachmentIds: parsed.data.attachment_ids,
      inReplyToId: parsed.data.in_reply_to_id,
    });
    if ('error' in result) return reply.code(result.code).send({ error: result.error, message: result.message });

    await writeAudit({
      tenantId: req.tenant.id,
      actorId: req.user.sub,
      action: parsed.data.internal ? 'thread.note_added' : 'thread.message_sent',
      entity: 'thread_entry',
      entityId: result.id,
      data: { case_id: id },
    });

    return reply.code(201).send({ id: result.id });
  });
}
