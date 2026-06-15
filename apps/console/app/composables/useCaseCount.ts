import { hasPermission } from '@egrm/core';

/** Total cases visible to the current user (for sidebar badge). */
export function useCaseCount() {
  const { api } = useApi();
  const { user } = useAuth();
  const count = useState<number | null>('case_nav_count', () => null);

  async function loadCaseCount() {
    const perms = user.value?.permissions ?? [];
    if (!hasPermission(perms, 'case:read')) {
      count.value = null;
      return;
    }
    try {
      const res = await api<{ total: number }>('/api/v1/cases', { query: { page: 1, page_size: 1 } });
      count.value = res.total;
    } catch {
      count.value = null;
    }
  }

  return { count, loadCaseCount };
}
