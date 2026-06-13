import { and, eq } from 'drizzle-orm';
import type { Cd02Hierarchy, Cd04Workflow, PartyNotificationChannel } from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import type { UserAccess } from './access.js';
import { canAccessCase } from './access.js';
import { enqueueNotifications } from './notifications.js';
import { scheduleOutboxDispatch } from './notification-queue.js';

type WorkflowTransition = Cd04Workflow['transitions'][number];

export interface AvailableTransition {
  type: 'transition';
  to_status: string;
  requires?: { note?: boolean; fields?: string[] };
}

export interface AvailableAssign {
  type: 'assign';
}

export type AvailableAction = AvailableTransition | AvailableAssign;

export interface CaseActionInput {
  action: 'transition' | 'assign';
  to_status?: string;
  assignee_id?: string;
  note?: string;
  action_taken?: string;
  update_summary?: string;
  fields?: Record<string, unknown>;
}

function transitionActionTaken(input: CaseActionInput): string {
  return input.action_taken?.trim() ?? String(input.fields?.action_taken ?? '').trim();
}

function transitionUpdateSummary(input: CaseActionInput): string {
  return input.update_summary?.trim() ?? String(input.fields?.update_summary ?? '').trim();
}

function transitionEffectiveNote(input: CaseActionInput): string {
  return input.note?.trim() || transitionActionTaken(input);
}

export type CaseActionResult =
  | { ok: true; case_id: string; status: string; assignee_id: string | null }
  | { ok: false; code: number; error: string; message?: string };

function levelIndex(hierarchy: Cd02Hierarchy, code: string): number {
  const needle = code.toLowerCase();
  return hierarchy.levels.findIndex((l) => l.code.toLowerCase() === needle);
}

function statusTag(workflow: Cd04Workflow, statusName: string): string {
  return workflow.statuses.find((s) => s.name === statusName)?.tag ?? 'open';
}

function userRoleNames(access: UserAccess): string[] {
  return [...new Set(access.assignments.map((a) => a.roleName))];
}

function hasWorkflowElevated(access: UserAccess): boolean {
  return (
    userRoleNames(access).includes('administrator')
    || access.permissions.some((p) => p === 'case:*' || p === 'admin:*')
  );
}

function transitionAllowed(
  transition: WorkflowTransition,
  caseRow: { status: string; levelCode: string },
  access: UserAccess,
): boolean {
  if (!transition.from.includes(caseRow.status)) return false;
  const roles = userRoleNames(access);
  if (!hasWorkflowElevated(access) && !transition.roles.some((r) => roles.includes(r))) return false;
  if (transition.levels?.length) {
    const ok = transition.levels.some((l) => l.toLowerCase() === caseRow.levelCode.toLowerCase());
    if (!ok) return false;
  }
  return true;
}

function findTransition(workflow: Cd04Workflow, fromStatus: string, toStatus: string): WorkflowTransition | null {
  return workflow.transitions.find((t) => t.from.includes(fromStatus) && t.to === toStatus) ?? null;
}

async function loadUnit(tenantId: string, unitId: string | null) {
  if (!unitId) return null;
  const [row] = await db
    .select()
    .from(schema.unit)
    .where(and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.id, unitId)))
    .limit(1);
  return row ?? null;
}

/** Walk unit parent chain. */
async function unitAncestors(tenantId: string, unitId: string): Promise<{ id: string; levelCode: string; parentId: string | null }[]> {
  const units = await db
    .select({ id: schema.unit.id, levelCode: schema.unit.levelCode, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));
  const byId = new Map(units.map((u) => [u.id, u]));
  const chain: { id: string; levelCode: string; parentId: string | null }[] = [];
  let cur: string | null = unitId;
  while (cur) {
    const u = byId.get(cur);
    if (!u) break;
    chain.push(u);
    cur = u.parentId;
  }
  return chain;
}

/** First descendant unit at target level (BFS). */
async function findDescendantAtLevel(
  tenantId: string,
  rootUnitId: string,
  targetLevelCode: string,
): Promise<string | null> {
  const units = await db
    .select({ id: schema.unit.id, levelCode: schema.unit.levelCode, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));

  const children = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parentId) continue;
    const list = children.get(u.parentId) ?? [];
    list.push(u.id);
    children.set(u.parentId, list);
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const target = targetLevelCode.toLowerCase();
  const queue = [rootUnitId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const u = byId.get(id);
    if (!u) continue;
    if (u.levelCode.toLowerCase() === target) return u.id;
    queue.push(...(children.get(id) ?? []));
  }
  return null;
}

async function applyMoveLevel(
  tenantId: string,
  hierarchy: Cd02Hierarchy,
  caseRow: { unitId: string | null; levelCode: string },
  direction: 'up' | 'down',
): Promise<{ levelCode: string; unitId: string | null }> {
  const idx = levelIndex(hierarchy, caseRow.levelCode);
  if (idx < 0) return { levelCode: caseRow.levelCode, unitId: caseRow.unitId };
  const newIdx = direction === 'up' ? idx + 1 : idx - 1;
  if (newIdx < 0 || newIdx >= hierarchy.levels.length) {
    return { levelCode: caseRow.levelCode, unitId: caseRow.unitId };
  }
  const newLevel = hierarchy.levels[newIdx]!.code;
  if (!caseRow.unitId) return { levelCode: newLevel, unitId: null };

  if (direction === 'up') {
    const chain = await unitAncestors(tenantId, caseRow.unitId);
    const match = chain.find((u) => u.levelCode.toLowerCase() === newLevel.toLowerCase());
    return { levelCode: newLevel, unitId: match?.id ?? caseRow.unitId };
  }

  const childId = await findDescendantAtLevel(tenantId, caseRow.unitId, newLevel);
  return { levelCode: newLevel, unitId: childId ?? caseRow.unitId };
}

function validateTransitionRequires(
  transition: WorkflowTransition,
  input: CaseActionInput,
): string | null {
  if (!transitionActionTaken(input)) return 'action_taken_required';
  if (!transitionUpdateSummary(input)) return 'update_summary_required';

  const req = transition.requires;
  if (!req) return null;
  const note = transitionEffectiveNote(input);
  if (req.note && !note) return 'note_required';
  if (req.fields?.length) {
    for (const field of req.fields) {
      const v = input.fields?.[field];
      if (v == null || (typeof v === 'string' && !v.trim())) return 'required_field_missing';
    }
  }
  return null;
}

function validateGuard(
  transition: WorkflowTransition,
  caseRow: { levelCode: string },
  access: UserAccess,
): string | null {
  if (transition.guard !== 'confirmation') return null;
  const roles = userRoleNames(access);
  const nationalRoles = roles.some((r) => r === 'grm_officer_national' || r === 'administrator');
  if (!nationalRoles) return 'confirmation_authority_required';
  const nationalLevel = caseRow.levelCode.toLowerCase() === 'national';
  if (!nationalLevel && !access.tenantWide) {
    // Allow national officers with tenant-wide scope to close from any level
    return null;
  }
  return null;
}

export async function getAvailableCaseActions(
  tenantId: string,
  caseId: string,
  access: UserAccess,
  actorId?: string,
): Promise<AvailableAction[] | { error: string; code: number }> {
  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { error: 'not_found', code: 404 };

  if (actorId) {
    const allowed = await canAccessCase(tenantId, access, actorId, {
      unitId: caseRow.unitId,
      assigneeId: caseRow.assigneeId,
      sensitivity: caseRow.sensitivity,
    });
    if (!allowed) return { error: 'not_found', code: 404 };
  }

  const workflow = await getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow');
  if (!workflow) return { error: 'tenant_not_configured', code: 503 };

  const actions: AvailableAction[] = [];

  if (hasPermission(access.permissions, 'case:transition')) {
    const seen = new Set<string>();
    for (const t of workflow.transitions) {
      if (!transitionAllowed(t, caseRow, access)) continue;
      if (seen.has(t.to)) continue;
      seen.add(t.to);
      actions.push({
        type: 'transition',
        to_status: t.to,
        requires: t.requires
          ? {
              note: t.requires.note,
              fields: t.requires.fields,
            }
          : undefined,
      });
    }
  }

  if (hasPermission(access.permissions, 'case:assign')) {
    actions.push({ type: 'assign' });
  }

  return actions;
}

export async function applyCaseAction(
  tenantId: string,
  caseId: string,
  actorId: string,
  access: UserAccess,
  input: CaseActionInput,
): Promise<CaseActionResult> {
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

  if (input.action === 'assign') {
    if (!hasPermission(access.permissions, 'case:assign')) {
      return { ok: false, code: 403, error: 'forbidden' };
    }
    if (!input.assignee_id) return { ok: false, code: 400, error: 'assignee_id_required' };

    const [assignee] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, tenantId), eq(schema.appUser.id, input.assignee_id), eq(schema.appUser.active, true)))
      .limit(1);
    if (!assignee) return { ok: false, code: 422, error: 'unknown_assignee' };

    let pendingOutboxId: string | null = null;
    const fromAssignee = caseRow.assigneeId;

    await db.transaction(async (tx) => {
      await tx
        .update(schema.grmCase)
        .set({ assigneeId: input.assignee_id!, updatedAt: new Date() })
        .where(eq(schema.grmCase.id, caseId));

      await tx.insert(schema.caseEvent).values({
        tenantId,
        caseId,
        kind: 'assigned',
        actorType: 'staff',
        actorId,
        visibility: 'internal',
        data: {
          from_assignee_id: fromAssignee,
          to_assignee_id: input.assignee_id,
          note: input.note?.trim() ?? null,
        },
      });

      const { outboxId } = await enqueueNotifications(
        {
          tenantId,
          caseId,
          event: 'case.assigned',
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
            assigneeId: input.assignee_id!,
            partyId: caseRow.partyId,
          },
        },
        tx,
      );
      pendingOutboxId = outboxId;
    });

    if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);

    return { ok: true, case_id: caseId, status: caseRow.status, assignee_id: input.assignee_id };
  }

  if (input.action !== 'transition') return { ok: false, code: 400, error: 'invalid_action' };
  if (!hasPermission(access.permissions, 'case:transition')) {
    return { ok: false, code: 403, error: 'forbidden' };
  }
  if (!input.to_status) return { ok: false, code: 400, error: 'to_status_required' };

  const workflow = await getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow');
  const hierarchy = await getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy');
  if (!workflow || !hierarchy) return { ok: false, code: 503, error: 'tenant_not_configured' };

  const transition = findTransition(workflow, caseRow.status, input.to_status);
  if (!transition || !transitionAllowed(transition, caseRow, access)) {
    return { ok: false, code: 422, error: 'transition_not_allowed' };
  }

  const reqErr = validateTransitionRequires(transition, input);
  if (reqErr) return { ok: false, code: 422, error: reqErr };

  const guardErr = validateGuard(transition, caseRow, access);
  if (guardErr) return { ok: false, code: 422, error: guardErr, message: 'National confirmation authority required' };

  const fromStatus = caseRow.status;
  let levelCode = caseRow.levelCode;
  let unitId = caseRow.unitId;
  let assigneeId = caseRow.assigneeId;

  for (const effect of transition.effects ?? []) {
    if ('move_level' in effect) {
      const moved = await applyMoveLevel(tenantId, hierarchy, { unitId, levelCode }, effect.move_level);
      levelCode = moved.levelCode;
      unitId = moved.unitId;
    }
    if ('set_assignee' in effect) {
      if (effect.set_assignee === 'none') assigneeId = null;
      if (effect.set_assignee === 'actor') assigneeId = actorId;
    }
  }

  const toStatus = input.to_status;
  const toTag = statusTag(workflow, toStatus);
  const actionTaken = transitionActionTaken(input);
  const updateSummary = transitionUpdateSummary(input);
  const transitionNote = transitionEffectiveNote(input);
  let pendingOutboxId: string | null = null;

  let partyNotificationChannels: PartyNotificationChannel[] | undefined;
  if (caseRow.partyId) {
    const [party] = await db
      .select({ notificationChannels: schema.party.notificationChannels })
      .from(schema.party)
      .where(eq(schema.party.id, caseRow.partyId))
      .limit(1);
    partyNotificationChannels = party?.notificationChannels?.length
      ? (party.notificationChannels as PartyNotificationChannel[])
      : undefined;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.grmCase)
      .set({
        status: toStatus,
        statusTag: toTag,
        levelCode,
        unitId,
        assigneeId,
        updatedAt: new Date(),
      })
      .where(eq(schema.grmCase.id, caseId));

    await tx.insert(schema.caseEvent).values({
      tenantId,
      caseId,
      kind: 'status_changed',
      actorType: 'staff',
      actorId,
      visibility: 'public',
      data: {
        from_status: fromStatus,
        to_status: toStatus,
        action_taken: actionTaken,
        update_summary: updateSummary,
        note: transitionNote || null,
        fields: input.fields ?? {},
        level_code: levelCode,
        unit_id: unitId,
      },
    });

    if (transitionNote) {
      await tx.insert(schema.caseEvent).values({
        tenantId,
        caseId,
        kind: 'note_internal',
        actorType: 'staff',
        actorId,
        visibility: 'internal',
        data: { body: transitionNote, context: 'transition', action_taken: actionTaken, update_summary: updateSummary },
      });
    }

    const { outboxId } = await enqueueNotifications(
      {
        tenantId,
        caseId,
        event: 'case.status_changed',
        case: {
          reference: caseRow.reference,
          status: toStatus,
          sensitivity: caseRow.sensitivity,
          priority: caseRow.priority,
          levelCode,
          channel: caseRow.channel,
          anonymous: caseRow.anonymous,
          categories: caseRow.categories,
          unitId,
          assigneeId,
          partyId: caseRow.partyId,
          partyNotificationChannels,
        },
        data: { from_status: fromStatus, to_status: toStatus },
      },
      tx,
    );
    pendingOutboxId = outboxId;

    if (assigneeId && assigneeId !== caseRow.assigneeId && transition.effects?.some((e) => 'set_assignee' in e)) {
      await enqueueNotifications(
        {
          tenantId,
          caseId,
          event: 'case.assigned',
          case: {
            reference: caseRow.reference,
            status: toStatus,
            sensitivity: caseRow.sensitivity,
            priority: caseRow.priority,
            levelCode,
            channel: caseRow.channel,
            anonymous: caseRow.anonymous,
            categories: caseRow.categories,
            unitId,
            assigneeId,
            partyId: caseRow.partyId,
          },
        },
        tx,
      );
    }
  });

  if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);

  return { ok: true, case_id: caseId, status: toStatus, assignee_id: assigneeId };
}
