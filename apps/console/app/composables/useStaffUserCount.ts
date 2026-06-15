import { canAccessAdminPage } from '@egrm/core';

export const STAFF_USERS_PATH = '/admin/settings/users';

/** Staff users visible to the current user (for sidebar badge). */
export function useStaffUserCount() {
  const { api } = useApi();
  const { user } = useAuth();
  const count = useState<number | null>('staff_user_nav_count', () => null);

  async function loadStaffUserCount() {
    const perms = user.value?.permissions ?? [];
    const opts = { managesStaffUsers: user.value?.manages_staff_users === true };
    if (!canAccessAdminPage(perms, STAFF_USERS_PATH, opts)) {
      count.value = null;
      return;
    }
    try {
      const res = await api<{ users: unknown[] }>('/api/v1/users');
      count.value = res.users.length;
    } catch {
      count.value = null;
    }
  }

  return { count, loadStaffUserCount };
}
