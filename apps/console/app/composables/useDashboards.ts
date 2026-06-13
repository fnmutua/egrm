import type { Widget, Section, Dashboard } from '~/types/dashboard';

export interface DashboardsConfig {
  dashboards: Dashboard[];
}

export function useDashboards() {
  const { api } = useApi();
  const { user } = useAuth();

  const dashboards = ref<Dashboard[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadDashboards() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api<{ payload: DashboardsConfig }>('/api/v1/config/cd15_dashboards');
      dashboards.value = res.payload?.dashboards ?? [];
    } catch {
      dashboards.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** The dashboard marked is_main that the current user's roles can access. */
  const mainDashboard = computed(() => {
    const roles = user.value?.roles?.map((r: { name: string }) => r.name) ?? [];
    return (
      dashboards.value.find((d) => {
        if (!d.is_main) return false;
        if (!d.audience?.roles?.length) return true;
        return d.audience.roles.some((r) => roles.includes(r));
      }) ?? dashboards.value[0] ?? null
    );
  });

  /** All dashboards visible to the current user (audience filter). */
  const visibleDashboards = computed(() => {
    const roles = user.value?.roles?.map((r: { name: string }) => r.name) ?? [];
    return dashboards.value.filter((d) => {
      if (!d.audience?.roles?.length) return true;
      return d.audience.roles.some((r) => roles.includes(r));
    });
  });

  async function fetchWidgetData(widget: Widget): Promise<{ rows: { label: string; value: number }[]; total: number }> {
    try {
      return await api('/api/v1/dashboards/widget', {
        method: 'POST',
        body: {
          dataset: widget.dataset,
          measure: widget.measure ?? 'id',
          aggregation: widget.aggregation ?? 'count',
          group_by: widget.group_by ?? [],
          time_dimension: widget.time_dimension,
          bucket: widget.bucket,
          filters: widget.filters ?? [],
        },
      });
    } catch {
      return { rows: [], total: 0 };
    }
  }

  return { dashboards, loading, error, loadDashboards, mainDashboard, visibleDashboards, fetchWidgetData };
}
