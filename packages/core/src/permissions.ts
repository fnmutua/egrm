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
  'attachment:read_protected',
  'attachment:delete_soft',
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

/** Grouped for role editor UIs (console / CD-10). */
export const PERMISSION_GROUPS: { label: string; permissions: readonly Permission[] }[] = [
  {
    label: 'Case handling',
    permissions: PERMISSIONS.filter((p) => p.startsWith('case:')),
  },
  {
    label: 'Threads & attachments',
    permissions: PERMISSIONS.filter((p) => p.startsWith('thread:') || p.startsWith('attachment:')),
  },
  {
    label: 'Sensitive cases',
    permissions: PERMISSIONS.filter((p) => p.startsWith('sensitive:')),
  },
  {
    label: 'Tasks & committees',
    permissions: PERMISSIONS.filter((p) => p.startsWith('task:') || p.startsWith('committee:')),
  },
  {
    label: 'Reporting & dashboards',
    permissions: PERMISSIONS.filter((p) => p.startsWith('report:') || p.startsWith('dashboard:')),
  },
  {
    label: 'Administration',
    permissions: PERMISSIONS.filter((p) => p.startsWith('admin:')),
  },
];

/** Wildcard families tenants may use in role definitions, e.g. `case:*`, `admin:*`. */
export const PERMISSION_WILDCARDS = ['case:*', 'thread:*', 'attachment:*', 'admin:*'] as const;

export function isValidPermissionPattern(pattern: string): boolean {
  if ((PERMISSION_WILDCARDS as readonly string[]).includes(pattern)) return true;
  if (pattern.endsWith(':*')) {
    const family = pattern.slice(0, -1);
    return PERMISSIONS.some((p) => p.startsWith(family));
  }
  return PERMISSIONS.includes(pattern as Permission);
}

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
