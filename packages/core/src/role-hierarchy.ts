import type { Permission } from './permissions.js';
import { expandPermission, hasPermission } from './permissions.js';

export interface RoleHierarchyNode {
  name: string;
  parent_role?: string | null;
  permissions?: string[];
}

/** Map parent role name → direct child role names. */
export function roleChildrenMap(roles: RoleHierarchyNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const role of roles) {
    const parent = role.parent_role?.trim();
    if (!parent) continue;
    const list = map.get(parent) ?? [];
    list.push(role.name);
    map.set(parent, list);
  }
  return map;
}

/** All descendant role names below `name` (not including `name`). */
export function roleDescendants(name: string, roles: RoleHierarchyNode[]): Set<string> {
  const children = roleChildrenMap(roles);
  const out = new Set<string>();
  const stack = [...(children.get(name) ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    if (out.has(current)) continue;
    out.add(current);
    for (const child of children.get(current) ?? []) stack.push(child);
  }
  return out;
}

/** Role names a holder may administer (assign to users, scope rights templates). */
export function manageableRoleNames(
  holderRoleNames: readonly string[],
  roles: RoleHierarchyNode[],
): Set<string> {
  const out = new Set<string>();
  for (const name of holderRoleNames) {
    for (const d of roleDescendants(name, roles)) out.add(d);
  }
  return out;
}

/** True when the target user holds any of the same roles as the holder (hierarchy peers). */
export function sharesHolderRole(
  holderRoleNames: readonly string[],
  targetRoleNames: readonly string[],
): boolean {
  const holder = new Set(holderRoleNames);
  return targetRoleNames.some((t) => holder.has(t));
}

/** True when any holder role and target role are siblings (same parent in the role tree). */
export function hasSiblingRolePair(
  holderRoleNames: readonly string[],
  targetRoleNames: readonly string[],
  roles: RoleHierarchyNode[],
): boolean {
  const byName = new Map(roles.map((r) => [r.name, r]));
  for (const h of holderRoleNames) {
    const parentH = byName.get(h)?.parent_role?.trim();
    if (!parentH) continue;
    for (const t of targetRoleNames) {
      if (h === t) return true;
      const parentT = byName.get(t)?.parent_role?.trim();
      if (parentT && parentT === parentH) return true;
    }
  }
  return false;
}

export function canManageTargetRole(
  holderRoleNames: readonly string[],
  holderPermissions: readonly string[],
  targetRoleName: string,
  roles: RoleHierarchyNode[],
): boolean {
  if (holderPermissions.includes('admin:*') || holderPermissions.includes('admin:users')) return true;
  return manageableRoleNames(holderRoleNames, roles).has(targetRoleName);
}

/** Full admin or holder of a role with descendants in the hierarchy. */
export function hasStaffUserManagementScope(
  holderRoleNames: readonly string[],
  holderPermissions: readonly string[],
  roles: RoleHierarchyNode[],
): boolean {
  if (holderPermissions.includes('admin:*') || holderPermissions.includes('admin:users')) return true;
  return manageableRoleNames(holderRoleNames, roles).size > 0;
}

/** Whether every role on the target user sits below the holder in the hierarchy. */
export function userRolesAreManageable(
  holderRoleNames: readonly string[],
  holderPermissions: readonly string[],
  targetRoleNames: readonly string[],
  roles: RoleHierarchyNode[],
  opts?: { pendingNoRoles?: boolean },
): boolean {
  if (holderPermissions.includes('admin:*') || holderPermissions.includes('admin:users')) return true;
  if (targetRoleNames.length === 0) return opts?.pendingNoRoles === true;
  const manageable = manageableRoleNames(holderRoleNames, roles);
  return targetRoleNames.every((n) => manageable.has(n));
}

/** Whether the holder may change role and jurisdiction assignments on the target user. */
export function canEditTargetUserRoleAssignments(
  holderRoleNames: readonly string[],
  holderPermissions: readonly string[],
  targetRoleNames: readonly string[],
  roles: RoleHierarchyNode[],
  opts?: { selfEdit?: boolean },
): boolean {
  if (opts?.selfEdit) {
    return holderPermissions.includes('admin:*') || holderPermissions.includes('admin:users');
  }
  if (holderPermissions.includes('admin:*') || holderPermissions.includes('admin:users')) return true;
  if (targetRoleNames.length === 0) return true;
  if (sharesHolderRole(holderRoleNames, targetRoleNames)) return false;
  if (hasSiblingRolePair(holderRoleNames, targetRoleNames, roles)) return false;
  const manageable = manageableRoleNames(holderRoleNames, roles);
  return targetRoleNames.every((n) => manageable.has(n));
}

/** Returns an error message when the hierarchy has a cycle, else null. */
export function detectRoleHierarchyCycle(roles: RoleHierarchyNode[]): string | null {
  const byName = new Map(roles.map((r) => [r.name, r]));
  for (const role of roles) {
    const seen = new Set<string>();
    let current: string | undefined = role.name;
    while (current) {
      if (seen.has(current)) {
        return `Role hierarchy cycle involving "${current}"`;
      }
      seen.add(current);
      const node = byName.get(current);
      const parent = node?.parent_role?.trim();
      current = parent || undefined;
    }
  }
  return null;
}

function wildcardCovers(parentPattern: string, childPattern: string): boolean {
  if (parentPattern === 'admin:*') return true;
  if (!childPattern.endsWith(':*')) return false;
  if (!parentPattern.endsWith(':*')) return false;
  return childPattern.startsWith(parentPattern.slice(0, -1));
}

/** Whether every permission on the child is granted by the parent's permission set. */
export function permissionsCoveredBy(parentPermissions: readonly string[], childPermissions: readonly string[]): boolean {
  if (parentPermissions.includes('admin:*')) return true;

  for (const child of childPermissions) {
    if (child.endsWith(':*')) {
      const covered = parentPermissions.some(
        (p) => p === child || wildcardCovers(p, child) || p === 'admin:*',
      );
      if (!covered) return false;
      const expanded = expandPermission(child);
      if (!expanded.every((perm) => hasPermission(parentPermissions, perm))) return false;
      continue;
    }
    if (!hasPermission(parentPermissions, child as Permission)) return false;
  }
  return true;
}

/** Permissions assignable to a child role given its parent's catalogue. */
export function grantablePermissions(parentPermissions: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (parentPermissions.includes('admin:*')) {
    for (const p of expandPermission('admin:*')) out.add(p);
    return out;
  }
  for (const p of parentPermissions) {
    if (p.endsWith(':*')) {
      for (const x of expandPermission(p)) out.add(x);
    } else {
      out.add(p);
    }
  }
  return out;
}

export function canGrantPermission(parentPermissions: readonly string[], permission: string): boolean {
  if (parentPermissions.includes('admin:*')) return true;
  if (permission.endsWith(':*')) {
    return parentPermissions.some((p) => p === permission || wildcardCovers(p, permission) || p === 'admin:*');
  }
  return hasPermission(parentPermissions, permission as Permission);
}

/** Drop child permissions not covered by the parent (used when reparenting in the editor). */
export function trimPermissionsToParent(
  parentPermissions: readonly string[],
  childPermissions: readonly string[],
): string[] {
  if (parentPermissions.includes('admin:*')) return [...childPermissions];
  return childPermissions.filter((p) => {
    if (p.endsWith(':*')) return canGrantPermission(parentPermissions, p);
    return hasPermission(parentPermissions, p as Permission);
  });
}

/** Recursively trim descendants so each role fits its direct parent. */
export function trimRoleSubtree(
  roles: RoleHierarchyNode[],
  rootName: string,
): RoleHierarchyNode[] {
  const byName = new Map(roles.map((r) => [r.name, { ...r, permissions: [...(r.permissions ?? [])] }]));
  const walk = (name: string) => {
    const role = byName.get(name);
    if (!role) return;
    for (const child of roles) {
      if (child.parent_role !== name || !child.name) continue;
      const row = byName.get(child.name);
      if (!row) continue;
      row.permissions = trimPermissionsToParent(role.permissions ?? [], row.permissions ?? []);
      walk(child.name);
    }
  };
  walk(rootName);
  return roles.map((r) => byName.get(r.name) ?? r);
}
