/**
 * Fixed platform permission catalogue (spec 07 §2).
 * Tenants compose roles from these; the catalogue itself is platform code.
 */
export const PERMISSIONS = [
  // Case handling
  'case:read',
  'case:create_assisted',
  'case:transition',
  'case:assign',
  'case:edit_fields',
  'case:merge',
  'case:export',
  'case:delete_soft',
  'case:restore',
  // Threads & attachments
  'thread:read',
  'thread:reply_external',
  'thread:note_internal',
  'attachment:upload',
  'attachment:download',
  // Sensitive cases (combined with sensitivity-class designation)
  'sensitive:read',
  'sensitive:handle',
  // Tasks & committees
  'task:manage',
  'committee:record_decision',
  // Reporting
  'report:view',
  'report:export',
  'dashboard:manage',
  // Administration (separate family — separation of duties)
  'admin:tenant_config',
  'admin:workflow_config',
  'admin:users',
  'admin:roles',
  'admin:hierarchy',
  'admin:notifications',
  'admin:audit_read',
  'admin:retention',
  'admin:ai_config',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Wildcard families usable in role definitions, e.g. `case:*`, `admin:*`. */
export function expandPermission(pattern: string): Permission[] {
  if (!pattern.endsWith(':*')) {
    return PERMISSIONS.includes(pattern as Permission) ? [pattern as Permission] : [];
  }
  const family = pattern.slice(0, -1); // keep trailing ':'
  return PERMISSIONS.filter((p) => p.startsWith(family));
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.some((g) => g === required || (g.endsWith(':*') && required.startsWith(g.slice(0, -1))));
}
