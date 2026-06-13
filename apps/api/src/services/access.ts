import { and, eq, inArray, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

export interface RoleAssignment {
  roleId: string;
  roleName: string;
  unitId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
}

export interface UserAccess {
  permissions: string[];
  assignments: RoleAssignment[];
  /** Any assignment without a unit scope → full tenant visibility. */
  tenantWide: boolean;
  /** Root unit IDs from scoped assignments (subtrees expanded at query time). */
  jurisdictionRoots: string[];
  sensitiveClasses: string[];
}

function isAssignmentActive(validFrom: Date | null, validTo: Date | null, now = new Date()): boolean {
  if (validFrom && validFrom > now) return false;
  if (validTo && validTo < now) return false;
  return true;
}

/** Load effective permissions and jurisdiction scope for a user. */
export async function loadUserAccess(userId: string, tenantId: string): Promise<UserAccess> {
  const assignments = await db
    .select({
      roleId: schema.userRole.roleId,
      unitId: schema.userRole.unitId,
      validFrom: schema.userRole.validFrom,
      validTo: schema.userRole.validTo,
      roleName: schema.role.name,
      permissions: schema.role.permissions,
      sensitiveClasses: schema.role.sensitiveClasses,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
    .where(and(eq(schema.userRole.userId, userId), eq(schema.role.tenantId, tenantId)));

  const now = new Date();
  const active = assignments.filter((a) => isAssignmentActive(a.validFrom, a.validTo, now));

  const permissions = [...new Set(active.flatMap((a) => a.permissions))];
  const sensitiveClasses = [...new Set(active.flatMap((a) => a.sensitiveClasses ?? []))];
  const tenantWide = active.some((a) => a.unitId == null);
  const jurisdictionRoots = [...new Set(active.map((a) => a.unitId).filter((id): id is string => id != null))];

  return {
    permissions,
    tenantWide,
    jurisdictionRoots,
    sensitiveClasses,
    assignments: active.map((a) => ({
      roleId: a.roleId,
      roleName: a.roleName,
      unitId: a.unitId,
      validFrom: a.validFrom,
      validTo: a.validTo,
    })),
  };
}

/** Expand unit IDs to include all descendants in the tenant unit tree. */
export async function expandUnitSubtrees(tenantId: string, rootIds: string[]): Promise<Set<string>> {
  if (rootIds.length === 0) return new Set();
  const units = await db
    .select({ id: schema.unit.id, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));

  const children = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parentId) continue;
    const list = children.get(u.parentId) ?? [];
    list.push(u.id);
    children.set(u.parentId, list);
  }

  const allowed = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (allowed.has(id)) continue;
    allowed.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return allowed;
}

/** SQL fragment: hide sensitive cases unless the user has clearance or is assignee. */
export function sensitivityListFilter(
  access: Pick<UserAccess, 'sensitiveClasses'>,
  userId: string,
): SQL {
  const parts: SQL[] = [eq(schema.grmCase.sensitivity, 'standard'), eq(schema.grmCase.assigneeId, userId)];
  if (access.sensitiveClasses.length > 0) {
    parts.push(inArray(schema.grmCase.sensitivity, access.sensitiveClasses));
  }
  return or(...parts)!;
}

/** Whether the actor may narrow the case list to this unit (must sit in their scope). */
export async function canFilterCasesByUnit(
  tenantId: string,
  access: Pick<UserAccess, 'tenantWide' | 'jurisdictionRoots'>,
  unitId: string,
): Promise<boolean> {
  if (access.tenantWide) return true;
  const allowed = await expandUnitSubtrees(tenantId, access.jurisdictionRoots);
  return allowed.has(unitId);
}

/** SQL fragment: cases located in a unit subtree (inclusive). */
export async function caseUnitSubtreeFilter(tenantId: string, unitId: string): Promise<SQL> {
  const allowed = await expandUnitSubtrees(tenantId, [unitId]);
  const allowedIds = [...allowed];
  if (allowedIds.length === 0) return eq(schema.grmCase.unitId, unitId);
  return inArray(schema.grmCase.unitId, allowedIds);
}

/** SQL fragment: cases visible under jurisdiction scope (or assigned to user). */
export async function caseVisibilityFilter(
  tenantId: string,
  access: Pick<UserAccess, 'tenantWide' | 'jurisdictionRoots'>,
  userId: string,
): Promise<SQL | undefined> {
  if (access.tenantWide) return undefined;

  const allowed = await expandUnitSubtrees(tenantId, access.jurisdictionRoots);
  const allowedIds = [...allowed];

  if (allowedIds.length === 0) {
    return eq(schema.grmCase.assigneeId, userId);
  }

  return or(
    eq(schema.grmCase.assigneeId, userId),
    inArray(schema.grmCase.unitId, allowedIds),
  )!;
}

/** Whether a case row is visible to the user (detail endpoint). */
export async function canAccessCase(
  tenantId: string,
  access: Pick<UserAccess, 'tenantWide' | 'jurisdictionRoots' | 'sensitiveClasses'>,
  userId: string,
  caseRow: { unitId: string | null; assigneeId: string | null; sensitivity: string },
): Promise<boolean> {
  if (caseRow.assigneeId === userId) return true;

  if (!access.tenantWide) {
    if (!caseRow.unitId) return false;
    const allowed = await expandUnitSubtrees(tenantId, access.jurisdictionRoots);
    if (!allowed.has(caseRow.unitId)) return false;
  }

  if (caseRow.sensitivity !== 'standard' && caseRow.sensitivity !== '') {
    if (!access.sensitiveClasses.includes(caseRow.sensitivity)) return false;
  }

  return true;
}
