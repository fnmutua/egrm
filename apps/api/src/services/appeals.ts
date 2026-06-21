import { and, desc, eq, sql } from 'drizzle-orm';
import type { Cd02Hierarchy, Cd04Workflow, Cd14Features } from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { verifyCaseByReference } from './correspondence.js';
import { moveCaseLevel } from './case-workflow.js';
import { enqueueNotifications } from './notifications.js';
import { scheduleOutboxDispatch } from './notification-queue.js';
import type { UserAccess } from './access.js';
import { canAccessCase } from './access.js';

const APPEAL_STATUS = 'Appealed';
const RESOLVED_STATUS = 'Resolved';
const INVESTIGATION_STATUS = 'Investigation';

export interface AppealEligibility {
  enabled: boolean;
  eligible: boolean;
  reason?: string;
  window_days?: number;
  window_ends_at?: string;
  days_remaining?: number;
  rounds_used?: number;
  max_rounds?: number;
  open_appeal?: boolean;
}

export interface ComplainantAppealView {
  round: number;
  status: 'open' | 'upheld' | 'dismissed';
  raised_at: string;
  decision: 'accepted' | 'rejected' | null;
  decided_at: string | null;
  outcome_label: string;
}

export interface AppealRow {
  id: string;
  round: number;
  raised_by: string;
  reason: string;
  raised_at: string;
  routed_to_level_code: string | null;
  status: string;
  decision: string | null;
  decision_note: string | null;
  decided_at: string | null;
}

function appealStatusName(workflow: Cd04Workflow): string {
  return workflow.statuses.find((s) => s.tag === 'appeal')?.name ?? APPEAL_STATUS;
}

function resolvedStatusName(workflow: Cd04Workflow): string {
  return workflow.statuses.find((s) => s.tag === 'resolved')?.name ?? RESOLVED_STATUS;
}

function investigationStatusName(workflow: Cd04Workflow): string {
  return (
    workflow.statuses.find((s) => s.tag === 'in_progress' && s.name.toLowerCase().includes('investig'))?.name
    ?? workflow.statuses.find((s) => s.tag === 'in_progress')?.name
    ?? INVESTIGATION_STATUS
  );
}

async function appealsFeatureEnabled(tenantId: string): Promise<boolean> {
  const features = await getActiveConfig<Cd14Features>(tenantId, 'cd14_features');
  return features?.appeals !== false;
}

async function countAppealRounds(tenantId: string, caseId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.caseAppeal)
    .where(and(eq(schema.caseAppeal.tenantId, tenantId), eq(schema.caseAppeal.caseId, caseId)));
  return row?.n ?? 0;
}

async function openAppealRow(tenantId: string, caseId: string) {
  const [row] = await db
    .select()
    .from(schema.caseAppeal)
    .where(
      and(
        eq(schema.caseAppeal.tenantId, tenantId),
        eq(schema.caseAppeal.caseId, caseId),
        eq(schema.caseAppeal.status, 'open'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAppealEligibility(
  tenantId: string,
  caseRow: {
    id: string;
    status: string;
    statusTag: string;
    resolvedAt: Date | null;
  },
): Promise<AppealEligibility> {
  const [workflow, featuresOn] = await Promise.all([
    getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow'),
    appealsFeatureEnabled(tenantId),
  ]);

  if (!featuresOn) return { enabled: false, eligible: false, reason: 'appeals_disabled' };
  const policy = workflow?.appeal;
  if (!policy?.enabled) return { enabled: false, eligible: false, reason: 'appeals_disabled' };

  const resolvedName = workflow ? resolvedStatusName(workflow) : RESOLVED_STATUS;
  if (caseRow.statusTag !== 'resolved' && caseRow.status !== resolvedName) {
    return { enabled: true, eligible: false, reason: 'not_resolved' };
  }

  const open = await openAppealRow(tenantId, caseRow.id);
  if (open) {
    return { enabled: true, eligible: false, reason: 'appeal_pending', open_appeal: true };
  }

  const rounds = await countAppealRounds(tenantId, caseRow.id);
  const maxRounds = policy.max_rounds;
  if (maxRounds && rounds >= maxRounds) {
    return {
      enabled: true,
      eligible: false,
      reason: 'max_rounds_reached',
      rounds_used: rounds,
      max_rounds: maxRounds,
    };
  }

  const windowDays = policy.window_days ?? 30;
  const anchor = caseRow.resolvedAt ?? new Date();
  const windowEnd = new Date(anchor.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now > windowEnd) {
    return {
      enabled: true,
      eligible: false,
      reason: 'window_closed',
      window_days: windowDays,
      window_ends_at: windowEnd.toISOString(),
      rounds_used: rounds,
      max_rounds: maxRounds,
    };
  }

  const msLeft = windowEnd.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  return {
    enabled: true,
    eligible: true,
    window_days: windowDays,
    window_ends_at: windowEnd.toISOString(),
    days_remaining: daysRemaining,
    rounds_used: rounds,
    max_rounds: maxRounds,
  };
}

function complainantOutcomeLabel(status: string, decision: string | null): string {
  if (status === 'open') return 'Your appeal is being reviewed.';
  if (status === 'upheld' || decision === 'accepted') {
    return 'Appeal accepted — the case will be reviewed further.';
  }
  if (status === 'dismissed' || decision === 'rejected') {
    return 'Appeal reviewed — the original resolution stands.';
  }
  return 'Appeal recorded.';
}

export async function listComplainantAppeals(
  tenantId: string,
  caseId: string,
): Promise<ComplainantAppealView[]> {
  const rows = await db
    .select()
    .from(schema.caseAppeal)
    .where(
      and(
        eq(schema.caseAppeal.tenantId, tenantId),
        eq(schema.caseAppeal.caseId, caseId),
        eq(schema.caseAppeal.raisedBy, 'party'),
      ),
    )
    .orderBy(desc(schema.caseAppeal.round));

  return rows.map((r) => ({
    round: r.round,
    status: r.status as ComplainantAppealView['status'],
    raised_at: r.raisedAt.toISOString(),
    decision: (r.decision as ComplainantAppealView['decision']) ?? null,
    decided_at: r.decidedAt?.toISOString() ?? null,
    outcome_label: complainantOutcomeLabel(r.status, r.decision),
  }));
}

export async function listCaseAppeals(tenantId: string, caseId: string): Promise<AppealRow[]> {
  const rows = await db
    .select()
    .from(schema.caseAppeal)
    .where(and(eq(schema.caseAppeal.tenantId, tenantId), eq(schema.caseAppeal.caseId, caseId)))
    .orderBy(desc(schema.caseAppeal.round));

  return rows.map((r) => ({
    id: r.id,
    round: r.round,
    raised_by: r.raisedBy,
    reason: r.reason,
    raised_at: r.raisedAt.toISOString(),
    routed_to_level_code: r.routedToLevelCode,
    status: r.status,
    decision: r.decision,
    decision_note: r.decisionNote,
    decided_at: r.decidedAt?.toISOString() ?? null,
  }));
}

export async function submitComplainantAppeal(input: {
  tenantId: string;
  reference: string;
  verifier: string;
  reason: string;
}): Promise<
  | { ok: true; appeal_id: string; status: string; round: number }
  | { ok: false; code: number; error: string; message?: string }
> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    return { ok: false, code: 422, error: 'reason_too_short', message: 'Please explain why you are appealing (at least 10 characters).' };
  }

  const verified = await verifyCaseByReference(input.tenantId, input.reference, input.verifier);
  if (!verified) return { ok: false, code: 404, error: 'case_not_found' };

  const caseRow = verified.case;
  const eligibility = await getAppealEligibility(input.tenantId, {
    id: caseRow.id,
    status: caseRow.status,
    statusTag: caseRow.statusTag,
    resolvedAt: caseRow.resolvedAt,
  });

  if (!eligibility.enabled) {
    return { ok: false, code: 403, error: 'appeals_disabled', message: 'Appeals are not enabled for this programme.' };
  }
  if (!eligibility.eligible) {
    const messages: Record<string, string> = {
      not_resolved: 'Appeals are only allowed after a case has been resolved.',
      appeal_pending: 'An appeal is already being reviewed for this case.',
      max_rounds_reached: 'The maximum number of appeals has been reached for this case.',
      window_closed: 'The appeal window for this resolution has closed.',
    };
    return {
      ok: false,
      code: 422,
      error: eligibility.reason ?? 'not_eligible',
      message: messages[eligibility.reason ?? ''] ?? 'This case cannot be appealed.',
    };
  }

  const [workflow, hierarchy] = await Promise.all([
    getActiveConfig<Cd04Workflow>(input.tenantId, 'cd04_workflow'),
    getActiveConfig<Cd02Hierarchy>(input.tenantId, 'cd02_hierarchy'),
  ]);
  if (!workflow || !hierarchy) {
    return { ok: false, code: 503, error: 'tenant_not_configured' };
  }

  const appealedStatus = appealStatusName(workflow);
  const round = (eligibility.rounds_used ?? 0) + 1;
  let levelCode = caseRow.levelCode;
  let unitId = caseRow.unitId;

  if (workflow.appeal?.routes_to === 'next_level') {
    const moved = await moveCaseLevel(input.tenantId, hierarchy, { unitId, levelCode }, 'up');
    levelCode = moved.levelCode;
    unitId = moved.unitId;
  }

  let appealId = '';
  let pendingOutboxId: string | null = null;

  await db.transaction(async (tx) => {
    const [appeal] = await tx
      .insert(schema.caseAppeal)
      .values({
        tenantId: input.tenantId,
        caseId: caseRow.id,
        round,
        raisedBy: 'party',
        reason,
        routedToLevelCode: levelCode,
        routedToUnitId: unitId,
        status: 'open',
      })
      .returning({ id: schema.caseAppeal.id });

    appealId = appeal!.id;

    await tx
      .update(schema.grmCase)
      .set({
        status: appealedStatus,
        statusTag: 'appeal',
        levelCode,
        unitId,
        assigneeId: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.grmCase.id, caseRow.id));

    await tx.insert(schema.caseEvent).values({
      tenantId: input.tenantId,
      caseId: caseRow.id,
      kind: 'appealed',
      actorType: 'complainant',
      visibility: 'public',
      data: {
        appeal_id: appealId,
        round,
        reason,
        from_status: caseRow.status,
        to_status: appealedStatus,
        level_code: levelCode,
      },
    });

    await tx.insert(schema.caseEvent).values({
      tenantId: input.tenantId,
      caseId: caseRow.id,
      kind: 'status_changed',
      actorType: 'complainant',
      visibility: 'public',
      data: {
        from_status: caseRow.status,
        to_status: appealedStatus,
        context: 'complainant_appeal',
        appeal_id: appealId,
        level_code: levelCode,
      },
    });

    const { outboxId } = await enqueueNotifications(
      {
        tenantId: input.tenantId,
        caseId: caseRow.id,
        event: 'appeal.opened',
        case: {
          reference: caseRow.reference,
          status: appealedStatus,
          sensitivity: caseRow.sensitivity,
          priority: caseRow.priority,
          levelCode,
          channel: caseRow.channel,
          anonymous: caseRow.anonymous,
          categories: caseRow.categories,
          unitId,
          assigneeId: null,
          partyId: caseRow.partyId,
        },
        data: { round, reason },
      },
      tx,
    );
    pendingOutboxId = outboxId;
  });

  if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);

  return { ok: true, appeal_id: appealId, status: appealedStatus, round };
}

export async function resolveOpenAppealOnTransition(input: {
  tenantId: string;
  caseId: string;
  fromStatus: string;
  toStatus: string;
  actorId: string;
  workflow: Cd04Workflow;
  note?: string;
}): Promise<void> {
  const appealedName = appealStatusName(input.workflow);
  if (input.fromStatus !== appealedName) return;

  const open = await openAppealRow(input.tenantId, input.caseId);
  if (!open) return;

  const investigationName = investigationStatusName(input.workflow);
  const resolvedName = resolvedStatusName(input.workflow);
  let status: 'upheld' | 'dismissed' = 'upheld';
  let decision = 'accepted';

  if (input.toStatus === investigationName) {
    status = 'upheld';
    decision = 'accepted';
  } else if (input.toStatus === resolvedName) {
    status = 'dismissed';
    decision = 'rejected';
  } else {
    return;
  }

  await db
    .update(schema.caseAppeal)
    .set({
      status,
      decision,
      decisionNote: input.note?.trim() || null,
      decidedBy: input.actorId,
      decidedAt: new Date(),
    })
    .where(eq(schema.caseAppeal.id, open.id));

  const partySummary =
    input.note?.trim()
    || (decision === 'accepted'
      ? 'Your appeal has been accepted and the case will be reviewed further.'
      : 'Your appeal has been reviewed and the original resolution stands.');

  await db.insert(schema.caseEvent).values({
    tenantId: input.tenantId,
    caseId: input.caseId,
    kind: 'appeal_decided',
    actorType: 'staff',
    actorId: input.actorId,
    visibility: 'public',
    data: {
      appeal_id: open.id,
      round: open.round,
      decision,
      outcome: status,
      to_status: input.toStatus,
      summary: partySummary,
    },
  });

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(eq(schema.grmCase.id, input.caseId))
    .limit(1);
  if (!caseRow) return;

  let pendingOutboxId: string | null = null;
  await db.transaction(async (tx) => {
    const { outboxId } = await enqueueNotifications(
      {
        tenantId: input.tenantId,
        caseId: input.caseId,
        event: 'appeal.decided',
        case: {
          reference: caseRow.reference,
          status: caseRow.status,
          sensitivity: caseRow.sensitivity,
          priority: caseRow.priority,
          levelCode: caseRow.levelCode,
          channel: caseRow.channel,
          anonymous: caseRow.anonymous,
          categories: caseRow.categories,
          unitId: caseRow.unitId,
          assigneeId: caseRow.assigneeId,
          partyId: caseRow.partyId,
        },
        data: { decision, round: open.round },
      },
      tx,
    );
    pendingOutboxId = outboxId;
  });

  if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);
}

export async function validateAppealWindowForClosure(
  tenantId: string,
  caseRow: { id: string; status: string; statusTag: string; resolvedAt: Date | null },
  workflow: Cd04Workflow,
): Promise<string | null> {
  const resolvedName = resolvedStatusName(workflow);
  if (caseRow.status !== resolvedName && caseRow.statusTag !== 'resolved') return null;
  if (!workflow.appeal?.enabled) return null;
  if (!(await appealsFeatureEnabled(tenantId))) return null;

  const open = await openAppealRow(tenantId, caseRow.id);
  if (open) return 'open_appeal_pending';

  const eligibility = await getAppealEligibility(tenantId, caseRow);
  if (eligibility.eligible) return 'appeal_window_open';

  return null;
}

export async function decideAppealAction(
  tenantId: string,
  caseId: string,
  appealId: string,
  actorId: string,
  access: UserAccess,
  input: { decision: 'uphold' | 'dismiss'; note?: string },
): Promise<{ ok: true } | { ok: false; code: number; error: string; message?: string }> {
  const canDecide =
    hasPermission(access.permissions, 'case:transition')
    || access.permissions.some((p) => p === 'case:*' || p === 'admin:*');
  if (!canDecide) {
    return { ok: false, code: 403, error: 'forbidden' };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { ok: false, code: 404, error: 'not_found' };

  const allowed = await canAccessCase(tenantId, access, actorId, {
    unitId: caseRow.unitId,
    assigneeId: caseRow.assigneeId,
    sensitivity: caseRow.sensitivity,
  });
  if (!allowed) return { ok: false, code: 404, error: 'not_found' };

  const [appeal] = await db
    .select()
    .from(schema.caseAppeal)
    .where(
      and(
        eq(schema.caseAppeal.tenantId, tenantId),
        eq(schema.caseAppeal.caseId, caseId),
        eq(schema.caseAppeal.id, appealId),
      ),
    )
    .limit(1);
  if (!appeal) return { ok: false, code: 404, error: 'appeal_not_found' };
  if (appeal.status !== 'open') return { ok: false, code: 409, error: 'appeal_already_decided' };

  const workflow = await getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow');
  if (!workflow) return { ok: false, code: 503, error: 'tenant_not_configured' };

  const { applyCaseAction } = await import('./case-workflow.js');
  const toStatus = input.decision === 'uphold' ? investigationStatusName(workflow) : resolvedStatusName(workflow);

  const result = await applyCaseAction(tenantId, caseId, actorId, access, {
    action: 'transition',
    to_status: toStatus,
    action_taken: input.decision === 'uphold' ? 'Appeal upheld' : 'Appeal dismissed',
    update_summary:
      input.note?.trim()
      || (input.decision === 'uphold' ? 'Appeal accepted — case returned to investigation.' : 'Appeal rejected — resolution stands.'),
    note: input.note,
  });

  if (!result.ok) return result;
  return { ok: true };
}
