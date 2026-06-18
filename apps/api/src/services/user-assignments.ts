import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import {
  caseVisibilityFilter,
  sensitivityListFilter,
  type UserAccess,
} from './access.js';

const TERMINAL_STATUS_TAGS = ['closed', 'rejected', 'resolved'];

/** Open workload counts per assignee (non-terminal status tags). */
export async function countOpenCasesByAssignee(
  tenantId: string,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      assigneeId: schema.grmCase.assigneeId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.grmCase)
    .where(
      and(
        eq(schema.grmCase.tenantId, tenantId),
        inArray(schema.grmCase.assigneeId, userIds),
        notInArray(schema.grmCase.statusTag, TERMINAL_STATUS_TAGS),
      ),
    )
    .groupBy(schema.grmCase.assigneeId);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.assigneeId) map.set(row.assigneeId, row.n);
  }
  return map;
}

export async function getUserAssignmentSummary(
  tenantId: string,
  userId: string,
): Promise<{ open_cases: number; assignments_made_30d: number }> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const [openRow, activityRow] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.grmCase)
      .where(
        and(
          eq(schema.grmCase.tenantId, tenantId),
          eq(schema.grmCase.assigneeId, userId),
          notInArray(schema.grmCase.statusTag, TERMINAL_STATUS_TAGS),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.caseEvent)
      .where(
        and(
          eq(schema.caseEvent.tenantId, tenantId),
          eq(schema.caseEvent.kind, 'assigned'),
          eq(schema.caseEvent.actorType, 'staff'),
          eq(schema.caseEvent.actorId, userId),
          gte(schema.caseEvent.createdAt, since),
        ),
      ),
  ]);

  return {
    open_cases: openRow[0]?.n ?? 0,
    assignments_made_30d: activityRow[0]?.n ?? 0,
  };
}

async function visibleCaseWhere(
  tenantId: string,
  viewerAccess: UserAccess,
  viewerId: string,
): Promise<SQL | undefined> {
  const scopeFilter = viewerAccess.tenantWide
    ? undefined
    : await caseVisibilityFilter(tenantId, viewerAccess, viewerId, undefined, 'jurisdiction');
  const sensitivityFilter = sensitivityListFilter(viewerAccess, viewerId);
  return and(eq(schema.grmCase.tenantId, tenantId), scopeFilter, sensitivityFilter);
}

export async function listUserCurrentAssignments(
  tenantId: string,
  viewerAccess: UserAccess,
  viewerId: string,
  targetUserId: string,
  page: number,
  pageSize: number,
) {
  const visibility = await visibleCaseWhere(tenantId, viewerAccess, viewerId);
  const where = and(visibility, eq(schema.grmCase.assigneeId, targetUserId));

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: schema.grmCase.id,
        reference: schema.grmCase.reference,
        status: schema.grmCase.status,
        statusTag: schema.grmCase.statusTag,
        summary: schema.grmCase.summary,
        priority: schema.grmCase.priority,
        levelCode: schema.grmCase.levelCode,
        unitName: schema.unit.name,
        updatedAt: schema.grmCase.updatedAt,
        createdAt: schema.grmCase.createdAt,
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(where)
      .orderBy(desc(schema.grmCase.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.grmCase).where(where),
  ]);

  return {
    cases: rows.map((c) => ({
      id: c.id,
      reference: c.reference,
      status: c.status,
      status_tag: c.statusTag,
      summary: c.summary,
      priority: c.priority,
      level_code: c.levelCode,
      unit_name: c.unitName,
      updated_at: c.updatedAt,
      created_at: c.createdAt,
    })),
    total: count?.n ?? 0,
    page,
    page_size: pageSize,
  };
}

type AssignmentEventData = {
  from_assignee_id?: string | null;
  to_assignee_id?: string | null;
  note?: string | null;
};

async function loadUserNameMap(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: schema.appUser.id, name: schema.appUser.displayName })
    .from(schema.appUser)
    .where(and(eq(schema.appUser.tenantId, tenantId), inArray(schema.appUser.id, unique)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listUserAssignmentActivity(
  tenantId: string,
  viewerAccess: UserAccess,
  viewerId: string,
  targetUserId: string,
  page: number,
  pageSize: number,
) {
  const visibility = await visibleCaseWhere(tenantId, viewerAccess, viewerId);
  const where = and(
    eq(schema.caseEvent.tenantId, tenantId),
    eq(schema.caseEvent.kind, 'assigned'),
    eq(schema.caseEvent.actorType, 'staff'),
    eq(schema.caseEvent.actorId, targetUserId),
    visibility,
  );

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: schema.caseEvent.id,
        caseId: schema.caseEvent.caseId,
        reference: schema.grmCase.reference,
        summary: schema.grmCase.summary,
        data: schema.caseEvent.data,
        createdAt: schema.caseEvent.createdAt,
      })
      .from(schema.caseEvent)
      .innerJoin(schema.grmCase, eq(schema.caseEvent.caseId, schema.grmCase.id))
      .where(where)
      .orderBy(desc(schema.caseEvent.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.caseEvent)
      .innerJoin(schema.grmCase, eq(schema.caseEvent.caseId, schema.grmCase.id))
      .where(where),
  ]);

  const userIds: string[] = [];
  for (const row of rows) {
    const data = (row.data ?? {}) as AssignmentEventData;
    if (data.from_assignee_id) userIds.push(data.from_assignee_id);
    if (data.to_assignee_id) userIds.push(data.to_assignee_id);
  }
  const names = await loadUserNameMap(tenantId, userIds);

  return {
    activity: rows.map((row) => {
      const data = (row.data ?? {}) as AssignmentEventData;
      const fromId = data.from_assignee_id ?? null;
      const toId = data.to_assignee_id ?? null;
      return {
        id: row.id,
        case_id: row.caseId,
        reference: row.reference,
        summary: row.summary,
        from_assignee_id: fromId,
        from_assignee_name: fromId ? (names.get(fromId) ?? 'Officer') : null,
        to_assignee_id: toId,
        to_assignee_name: toId ? (names.get(toId) ?? 'Officer') : null,
        note: data.note ?? null,
        created_at: row.createdAt,
      };
    }),
    total: count?.n ?? 0,
    page,
    page_size: pageSize,
  };
}
