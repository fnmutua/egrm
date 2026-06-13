import type { ConfigDomain } from './config-domains.js';
import { hasPermission, type Permission } from './permissions.js';

/** Primary permission required to edit a config domain (spec 07 — separation of duties). */
const DOMAIN_PERMISSIONS: Partial<Record<ConfigDomain, Permission>> = {
  cd02_hierarchy: 'admin:hierarchy',
  cd04_workflow: 'admin:workflow_config',
  cd09_notifications: 'admin:notifications',
  cd10_org_access: 'admin:roles',
  cd13_reporting: 'admin:retention',
  cd16_ai: 'admin:ai_config',
};

export function configDomainPermission(domain: ConfigDomain): Permission {
  return DOMAIN_PERMISSIONS[domain] ?? 'admin:tenant_config';
}

/** Whether the user may read or write a config domain (draft, activate, history). */
export function canAccessConfigDomain(granted: readonly string[], domain: ConfigDomain): boolean {
  if (granted.includes('admin:*')) return true;
  if (hasPermission(granted, 'admin:tenant_config')) return true;
  return hasPermission(granted, configDomainPermission(domain));
}

/** Any admin-family permission — enough to open the admin console shell. */
export function canAccessAdminConsole(granted: readonly string[]): boolean {
  return granted.some((g) => g === 'admin:*' || g.startsWith('admin:'));
}

/** Standalone admin pages outside the config registry. */
export function canAccessAdminPage(
  granted: readonly string[],
  path: string,
  opts?: { managesStaffUsers?: boolean },
): boolean {
  if (path === '/admin/units') {
    return (
      hasPermission(granted, 'admin:hierarchy') ||
      hasPermission(granted, 'admin:tenant_config') ||
      granted.includes('admin:*')
    );
  }
  if (path === '/admin/users') {
    return (
      hasPermission(granted, 'admin:users') ||
      granted.includes('admin:*') ||
      opts?.managesStaffUsers === true
    );
  }
  return canAccessAdminConsole(granted);
}
