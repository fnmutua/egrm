import {
  canAccessAdminConsole,
  canAccessAdminPage,
  canAccessConfigDomain,
  type ConfigDomain,
} from '@egrm/core';

export function usePermissions() {
  const { user } = useAuth();

  const permissions = computed(() => user.value?.permissions ?? []);
  const managesStaffUsers = computed(() => user.value?.manages_staff_users === true);

  function canConfig(domain: string) {
    return canAccessConfigDomain(permissions.value, domain as ConfigDomain);
  }

  function canAdmin() {
    return canAccessAdminConsole(permissions.value);
  }

  function canPage(path: string) {
    return canAccessAdminPage(permissions.value, path, {
      managesStaffUsers: managesStaffUsers.value,
    });
  }

  return { permissions, managesStaffUsers, canConfig, canAdmin, canPage };
}
