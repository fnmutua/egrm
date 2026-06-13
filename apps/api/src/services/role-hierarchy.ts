import type { Cd10OrgAccess } from '@egrm/config-schemas';
import {
  canManageTargetRole,
  hasStaffUserManagementScope,
  manageableRoleNames,
  userRolesAreManageable,
} from '@egrm/core';
import { getActiveConfig } from './config.js';
import { loadUserAccess } from './access.js';

export type RoleCatalogEntry = Cd10OrgAccess['roles'][number];

export type StaffUserManagerContext = {
  fullAdmin: boolean;
  holderRoleNames: string[];
  permissions: string[];
  manageableRoleNames: Set<string>;
};

export async function buildStaffUserManagerContext(
  userId: string,
  tenantId: string,
): Promise<StaffUserManagerContext> {
  const [access, catalog] = await Promise.all([
    loadUserAccess(userId, tenantId),
    getRoleCatalog(tenantId),
  ]);
  const holderRoleNames = access.assignments.map((a) => a.roleName);
  const permissions = access.permissions;
  const fullAdmin = permissions.includes('admin:*') || permissions.includes('admin:users');
  return {
    fullAdmin,
    holderRoleNames,
    permissions,
    manageableRoleNames: manageableRoleNames(holderRoleNames, catalog),
  };
}

export function canAccessStaffUserManagement(ctx: StaffUserManagerContext, catalog: RoleCatalogEntry[]): boolean {
  return hasStaffUserManagementScope(ctx.holderRoleNames, ctx.permissions, catalog);
}

export function targetUserIsManageable(
  ctx: StaffUserManagerContext,
  targetRoleNames: string[],
  catalog: RoleCatalogEntry[],
  opts?: { pendingNoRoles?: boolean },
): boolean {
  return userRolesAreManageable(ctx.holderRoleNames, ctx.permissions, targetRoleNames, catalog, opts);
}

export async function getRoleCatalog(tenantId: string): Promise<RoleCatalogEntry[]> {
  const cfg = await getActiveConfig<Cd10OrgAccess>(tenantId, 'cd10_org_access');
  return cfg?.roles ?? [];
}

export function validateAssignableRoles(
  holderRoleNames: string[],
  holderPermissions: string[],
  assignments: { role_id: string }[],
  roles: RoleCatalogEntry[],
  roleIdToName: Map<string, string>,
): string | null {
  for (const a of assignments) {
    const roleName = roleIdToName.get(a.role_id);
    if (!roleName) return `Unknown role: ${a.role_id}`;
    if (!canManageTargetRole(holderRoleNames, holderPermissions, roleName, roles)) {
      return `You may not assign role "${roleName}" — it is not below your role(s) in the hierarchy`;
    }
  }
  return null;
}
