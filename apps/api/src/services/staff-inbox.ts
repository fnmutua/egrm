import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NotificationRule } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';

type RecipientSelector = NotificationRule['to'][number];

interface InAppLogRow {
  id: string;
  caseId: string | null;
  eventKind: string;
  renderedPreview: string | null;
  recipientSelector: unknown;
  createdAt: Date;
  caseReference: string | null;
  assigneeId: string | null;
  unitId: string | null;
}

interface InboxItem {
  id: string;
  case_id: string | null;
  case_reference: string | null;
  event_kind: string;
  title: string;
  body: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

async function ancestorUnitIds(tenantId: string, unitId: string | null): Promise<Set<string>> {
  if (!unitId) return new Set();
  const units = await db
    .select({ id: schema.unit.id, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));

  const byId = new Map(units.map((u) => [u.id, u.parentId]));
  const chain = new Set<string>();
  let cur: string | null | undefined = unitId;
  while (cur) {
    chain.add(cur);
    cur = byId.get(cur) ?? null;
  }
  return chain;
}

/** Resolve staff user IDs for in-app delivery. */
export async function resolveInAppUserIds(
  tenantId: string,
  selector: RecipientSelector,
  caseRow: {
    assigneeId: string | null;
    unitId: string | null;
  },
): Promise<string[]> {
  if ('party' in selector || ('address' in selector && selector.address)) return [];

  if ('user' in selector) {
    const userId = selector.user === 'assignee' ? caseRow.assigneeId : null;
    return userId ? [userId] : [];
  }

  if ('role' in selector) {
    const roleName = selector.role;
    const scope = selector.scope ?? 'case_unit';
    const assignments = await db
      .select({
        userId: schema.userRole.userId,
        unitId: schema.userRole.unitId,
      })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .innerJoin(schema.appUser, eq(schema.userRole.userId, schema.appUser.id))
      .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, roleName), eq(schema.appUser.active, true)));

    if (scope === 'tenant') {
      return [...new Set(assignments.map((a) => a.userId))];
    }

    const caseChain = await ancestorUnitIds(tenantId, caseRow.unitId);
    const matched = assignments.filter((a) => {
      if (!a.unitId) return false;
      if (scope === 'case_unit') return a.unitId === caseRow.unitId;
      if (scope === 'unit_and_above') return caseChain.has(a.unitId);
      if (scope === 'level') return true;
      return false;
    });

    return [...new Set(matched.map((a) => a.userId))];
  }

  return [];
}

function humanizeEventKind(kind: string): string {
  return kind.replaceAll('.', ' · ').replaceAll('_', ' ');
}

function inboxTitle(log: InAppLogRow): string {
  const label = humanizeEventKind(log.eventKind);
  return log.caseReference ? `${label} — ${log.caseReference}` : label;
}

function inboxBody(log: InAppLogRow): string {
  return log.renderedPreview?.trim() || inboxTitle(log);
}

/** In-app notification_log rows this user is a recipient of (same source as case detail tab). */
async function loadInAppLogsForUser(tenantId: string, userId: string): Promise<InAppLogRow[]> {
  const logs = await db
    .select({
      id: schema.notificationLog.id,
      caseId: schema.notificationLog.caseId,
      eventKind: schema.notificationLog.eventKind,
      renderedPreview: schema.notificationLog.renderedPreview,
      recipientSelector: schema.notificationLog.recipientSelector,
      createdAt: schema.notificationLog.createdAt,
      caseReference: schema.grmCase.reference,
      assigneeId: schema.grmCase.assigneeId,
      unitId: schema.grmCase.unitId,
    })
    .from(schema.notificationLog)
    .leftJoin(schema.grmCase, eq(schema.notificationLog.caseId, schema.grmCase.id))
    .where(
      and(
        eq(schema.notificationLog.tenantId, tenantId),
        eq(schema.notificationLog.channel, 'in_app'),
        or(
          eq(schema.notificationLog.status, 'queued'),
          eq(schema.notificationLog.status, 'sent'),
          sql`${schema.notificationLog.status} LIKE 'sent:%'`,
        ),
      ),
    )
    .orderBy(desc(schema.notificationLog.createdAt))
    .limit(1000);

  const resolveCache = new Map<string, string[]>();
  const matched: InAppLogRow[] = [];

  for (const log of logs) {
    const selector = log.recipientSelector as RecipientSelector | null;
    if (!selector || !log.caseId) continue;

    const cacheKey = `${log.caseId}:${JSON.stringify(selector)}`;
    let userIds = resolveCache.get(cacheKey);
    if (!userIds) {
      userIds = await resolveInAppUserIds(tenantId, selector, {
        assigneeId: log.assigneeId,
        unitId: log.unitId,
      });
      resolveCache.set(cacheKey, userIds);
    }
    if (userIds.includes(userId)) matched.push(log);
  }

  return matched;
}

async function loadInboxStates(
  tenantId: string,
  userId: string,
  notificationLogIds: string[],
) {
  if (notificationLogIds.length === 0) return new Map<string, { readAt: Date | null; dismissedAt: Date | null }>();

  const rows = await db
    .select({
      notificationLogId: schema.staffInboxNotification.notificationLogId,
      readAt: schema.staffInboxNotification.readAt,
      dismissedAt: schema.staffInboxNotification.dismissedAt,
    })
    .from(schema.staffInboxNotification)
    .where(
      and(
        eq(schema.staffInboxNotification.tenantId, tenantId),
        eq(schema.staffInboxNotification.userId, userId),
        inArray(schema.staffInboxNotification.notificationLogId, notificationLogIds),
      ),
    );

  return new Map(
    rows
      .filter((r): r is typeof r & { notificationLogId: string } => r.notificationLogId != null)
      .map((r) => [r.notificationLogId, { readAt: r.readAt, dismissedAt: r.dismissedAt }]),
  );
}

function toInboxItem(log: InAppLogRow, state?: { readAt: Date | null; dismissedAt: Date | null }): InboxItem {
  return {
    id: log.id,
    case_id: log.caseId,
    case_reference: log.caseReference,
    event_kind: log.eventKind,
    title: inboxTitle(log),
    body: inboxBody(log),
    read_at: state?.readAt?.toISOString() ?? null,
    dismissed_at: state?.dismissedAt?.toISOString() ?? null,
    created_at: log.createdAt.toISOString(),
  };
}

export async function createStaffInboxEntries(input: {
  tenantId: string;
  userIds: string[];
  caseId: string | null;
  notificationLogId: string;
  eventKind: string;
  title: string;
  body: string;
}): Promise<number> {
  const unique = [...new Set(input.userIds)];
  if (unique.length === 0) return 0;

  await db.insert(schema.staffInboxNotification).values(
    unique.map((userId) => ({
      tenantId: input.tenantId,
      userId,
      caseId: input.caseId,
      notificationLogId: input.notificationLogId,
      eventKind: input.eventKind,
      title: input.title,
      body: input.body,
    })),
  );

  return unique.length;
}

export async function countUnreadStaffInbox(tenantId: string, userId: string): Promise<number> {
  const logs = await loadInAppLogsForUser(tenantId, userId);
  const states = await loadInboxStates(tenantId, userId, logs.map((l) => l.id));

  return logs.filter((log) => {
    const state = states.get(log.id);
    return !state?.dismissedAt && !state?.readAt;
  }).length;
}

export async function listStaffInbox(
  tenantId: string,
  userId: string,
  opts: { status?: 'all' | 'unread' | 'dismissed'; page?: number; pageSize?: number },
) {
  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 30, 100);
  const status = opts.status ?? 'all';

  const logs = await loadInAppLogsForUser(tenantId, userId);
  const states = await loadInboxStates(tenantId, userId, logs.map((l) => l.id));

  const filtered = logs.filter((log) => {
    const state = states.get(log.id);
    const dismissed = Boolean(state?.dismissedAt);
    const unread = !dismissed && !state?.readAt;
    if (status === 'dismissed') return dismissed;
    if (status === 'unread') return unread;
    return !dismissed;
  });

  const offset = (page - 1) * pageSize;
  const pageLogs = filtered.slice(offset, offset + pageSize);
  const unreadCount = logs.filter((log) => {
    const state = states.get(log.id);
    return !state?.dismissedAt && !state?.readAt;
  }).length;

  return {
    notifications: pageLogs.map((log) => toInboxItem(log, states.get(log.id))),
    total: filtered.length,
    unread_count: unreadCount,
    page,
    page_size: pageSize,
  };
}

async function verifyInAppRecipient(
  tenantId: string,
  userId: string,
  notificationLogId: string,
): Promise<InAppLogRow | null> {
  const [log] = await db
    .select({
      id: schema.notificationLog.id,
      caseId: schema.notificationLog.caseId,
      eventKind: schema.notificationLog.eventKind,
      renderedPreview: schema.notificationLog.renderedPreview,
      recipientSelector: schema.notificationLog.recipientSelector,
      createdAt: schema.notificationLog.createdAt,
      caseReference: schema.grmCase.reference,
      assigneeId: schema.grmCase.assigneeId,
      unitId: schema.grmCase.unitId,
    })
    .from(schema.notificationLog)
    .leftJoin(schema.grmCase, eq(schema.notificationLog.caseId, schema.grmCase.id))
    .where(
      and(
        eq(schema.notificationLog.id, notificationLogId),
        eq(schema.notificationLog.tenantId, tenantId),
        eq(schema.notificationLog.channel, 'in_app'),
      ),
    )
    .limit(1);

  if (!log?.caseId) return null;

  const selector = log.recipientSelector as RecipientSelector | null;
  if (!selector) return null;

  const userIds = await resolveInAppUserIds(tenantId, selector, {
    assigneeId: log.assigneeId,
    unitId: log.unitId,
  });
  if (!userIds.includes(userId)) return null;

  return log;
}

async function upsertInboxState(
  tenantId: string,
  userId: string,
  log: InAppLogRow,
  patch: { readAt: Date | null; dismissedAt: Date | null },
) {
  const [existing] = await db
    .select({ id: schema.staffInboxNotification.id })
    .from(schema.staffInboxNotification)
    .where(
      and(
        eq(schema.staffInboxNotification.tenantId, tenantId),
        eq(schema.staffInboxNotification.userId, userId),
        eq(schema.staffInboxNotification.notificationLogId, log.id),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.staffInboxNotification)
      .set(patch)
      .where(eq(schema.staffInboxNotification.id, existing.id));
    return;
  }

  await db.insert(schema.staffInboxNotification).values({
    tenantId,
    userId,
    caseId: log.caseId,
    notificationLogId: log.id,
    eventKind: log.eventKind,
    title: inboxTitle(log),
    body: inboxBody(log),
    readAt: patch.readAt,
    dismissedAt: patch.dismissedAt,
  });
}

export async function updateStaffInboxNotification(
  tenantId: string,
  userId: string,
  notificationLogId: string,
  action: 'read' | 'unread' | 'dismiss',
): Promise<{ ok: true } | { error: string; code: number }> {
  const log = await verifyInAppRecipient(tenantId, userId, notificationLogId);
  if (!log) return { error: 'not_found', code: 404 };

  const now = new Date();
  if (action === 'read') {
    await upsertInboxState(tenantId, userId, log, { readAt: now, dismissedAt: null });
  } else if (action === 'unread') {
    await upsertInboxState(tenantId, userId, log, { readAt: null, dismissedAt: null });
  } else {
    await upsertInboxState(tenantId, userId, log, { readAt: now, dismissedAt: now });
  }

  return { ok: true };
}

export async function markAllStaffInboxRead(tenantId: string, userId: string): Promise<number> {
  const logs = await loadInAppLogsForUser(tenantId, userId);
  const states = await loadInboxStates(tenantId, userId, logs.map((l) => l.id));
  const now = new Date();
  let updated = 0;

  for (const log of logs) {
    const state = states.get(log.id);
    if (state?.dismissedAt || state?.readAt) continue;
    await upsertInboxState(tenantId, userId, log, { readAt: now, dismissedAt: null });
    updated += 1;
  }

  return updated;
}
