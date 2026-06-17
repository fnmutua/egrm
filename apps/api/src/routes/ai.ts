import type { FastifyInstance } from 'fastify';
import { hasPermission } from '@egrm/core';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { AuthUser } from '../plugins/auth.js';
import { canAccessCaseForTriageReview } from '../services/access.js';
import { decideAiInteraction, decideBodySchema, getCaseAiTriageView, listCaseAiInteractions, runIntakeTriage } from '../services/ai-triage.js';
import { runCaseAiSuggest, suggestBodySchema } from '../services/ai-suggest.js';

const listQuery = z.object({
  pending: z.coerce.boolean().optional(),
});

/** Staff AI triage endpoints (spec 16 §7). */
export default async function aiRoutes(app: FastifyInstance) {
  async function loadCaseForAi(tenantId: string, caseId: string, user: AuthUser) {
    const [c] = await db
      .select({
        unitId: schema.grmCase.unitId,
        assigneeId: schema.grmCase.assigneeId,
        sensitivity: schema.grmCase.sensitivity,
      })
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
      .limit(1);
    if (!c) return { ok: false as const, code: 404 as const };
    const allowed = await canAccessCaseForTriageReview(tenantId, user, user.sub, caseId, c);
    if (!allowed) return { ok: false as const, code: 404 as const };
    return { ok: true as const, case: c };
  }

  app.get(
    '/api/v1/cases/:id/ai/triage',
    { onRequest: [app.requirePermission('case:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const access = await loadCaseForAi(req.tenant.id, id, req.user);
      if (!access.ok) return reply.code(access.code).send({ error: 'not_found' });
      return getCaseAiTriageView(req.tenant.id, id);
    },
  );

  app.post(
    '/api/v1/cases/:id/ai/triage/run',
    { onRequest: [app.requirePermission('case:edit_fields')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const access = await loadCaseForAi(req.tenant.id, id, req.user);
      if (!access.ok) return reply.code(access.code).send({ error: 'not_found' });

      const view = await getCaseAiTriageView(req.tenant.id, id);
      if (!view.config.ready) {
        return reply.code(503).send({ error: 'ai_triage_disabled', config: view.config });
      }

      await runIntakeTriage(req.tenant.id, id);
      return getCaseAiTriageView(req.tenant.id, id);
    },
  );

  app.post(
    '/api/v1/cases/:id/ai/suggest',
    { onRequest: [app.requirePermission('case:transition')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = suggestBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

      const access = await loadCaseForAi(req.tenant.id, id, req.user);
      if (!access.ok) return reply.code(access.code).send({ error: 'not_found' });

      const result = await runCaseAiSuggest(
        req.tenant.id,
        id,
        parsed.data.capability,
        parsed.data.params,
      );
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error, message: result.message });
      }
      return result;
    },
  );

  app.get(
    '/api/v1/cases/:id/ai/interactions',
    { onRequest: [app.requirePermission('case:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });

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

      const allowed = await canAccessCaseForTriageReview(req.tenant.id, req.user, req.user.sub, id, c);
      if (!allowed) return reply.code(404).send({ error: 'not_found' });

      const interactions = await listCaseAiInteractions(req.tenant.id, id, {
        pendingOnly: parsed.data.pending,
      });
      return { interactions };
    },
  );

  app.post(
    '/api/v1/ai/interactions/:id/decide',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = decideBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

      const [row] = await db
        .select({
          caseId: schema.aiInteraction.caseId,
          capability: schema.aiInteraction.capability,
        })
        .from(schema.aiInteraction)
        .where(and(eq(schema.aiInteraction.tenantId, req.tenant.id), eq(schema.aiInteraction.id, id)))
        .limit(1);
      if (!row?.caseId) return reply.code(404).send({ error: 'not_found' });

      const [c] = await db
        .select({
          unitId: schema.grmCase.unitId,
          assigneeId: schema.grmCase.assigneeId,
          sensitivity: schema.grmCase.sensitivity,
        })
        .from(schema.grmCase)
        .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.id, row.caseId)))
        .limit(1);
      if (!c) return reply.code(404).send({ error: 'not_found' });

      const allowed = await canAccessCaseForTriageReview(req.tenant.id, req.user, req.user.sub, row.caseId, c);
      if (!allowed) return reply.code(404).send({ error: 'not_found' });

      const wantsEdit =
        row.capability !== 'draft_response' &&
        (parsed.data.decision === 'accepted' ||
          parsed.data.decision === 'edited' ||
          Boolean(parsed.data.edited_payload?.categories?.length) ||
          Boolean(parsed.data.edited_payload?.priority));
      const wantsSensitivity =
        row.capability !== 'draft_response' &&
        (parsed.data.edited_payload?.confirm_sensitivity || parsed.data.edited_payload?.clear_sensitivity);

      if (row.capability === 'draft_response') {
        if (
          !hasPermission(req.user.permissions, 'case:transition') &&
          !hasPermission(req.user.permissions, 'thread:reply_external')
        ) {
          return reply.code(403).send({ error: 'forbidden', message: 'case:transition or thread:reply_external required' });
        }
      } else if (wantsEdit && !hasPermission(req.user.permissions, 'case:edit_fields')) {
        return reply.code(403).send({ error: 'forbidden', message: 'case:edit_fields required' });
      }
      if (wantsSensitivity && !hasPermission(req.user.permissions, 'sensitive:handle')) {
        return reply.code(403).send({ error: 'forbidden', message: 'sensitive:handle required' });
      }

      const result = await decideAiInteraction(req.tenant.id, id, req.user.sub, parsed.data);
      if (!result.ok) return reply.code(result.code).send({ error: result.error });
      return result;
    },
  );
}
