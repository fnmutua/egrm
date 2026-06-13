import type { Cd10OrgAccess } from '@egrm/config-schemas';
import { canManageTargetRole } from '@egrm/core';
import { getActiveConfig } from './config.js';

export type RoleCatalogEntry = Cd10OrgAccess['roles'][number];

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
