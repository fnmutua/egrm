import type { Widget, Section, Dashboard, FilterDef } from '~/types/dashboard';
import { useDashboardUnitFilter } from '~/composables/useDashboardUnitFilter';

export interface DashboardsConfig {
  dashboards: Dashboard[];
}

const TIME_CHARTS = new Set(['line', 'multi_line', 'area']);

function mergeWidgetFilters(widgetFilters: FilterDef[] | undefined, unitId: string | null): FilterDef[] {
  const base = [...(widgetFilters ?? [])].filter((f) => f.field !== 'unit_id');
  if (unitId) base.push({ field: 'unit_id', op: 'eq', value: unitId });
  return base;
}

export function useDashboards() {
  const { api } = useApi();
  const { user } = useAuth();
  const { effectiveUnitId } = useDashboardUnitFilter();

  const dashboards = ref<Dashboard[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadDashboards() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api<{ payload: DashboardsConfig }>('/api/v1/dashboards/layout');
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

  async function fetchWidgetData(widget: Widget): Promise<{
    rows: { label: string; value: number }[];
    series: { name: string; data: number[] }[];
    categories: string[];
    total: number;
    sparkline?: { label: string; value: number }[];
  }> {
    const groupBy = [...(widget.group_by ?? [])];
    if ((!groupBy[0] || !groupBy[0].startsWith('unit_level:')) && widget.unit_level) {
      groupBy[0] = `unit_level:${widget.unit_level}`;
    }
    try {
      return await api('/api/v1/dashboards/widget', {
        method: 'POST',
        body: {
          dataset: widget.dataset,
          chart_kind: widget.chart_kind,
          measure: widget.measure ?? 'id',
          aggregation: widget.aggregation ?? 'count',
          group_by: groupBy,
          unit_level: widget.unit_level,
          time_dimension: TIME_CHARTS.has(widget.chart_kind) ? widget.time_dimension : undefined,
          bucket: TIME_CHARTS.has(widget.chart_kind) ? widget.bucket : undefined,
          filters: mergeWidgetFilters(widget.filters, effectiveUnitId.value),
          sparkline_period: widget.chart_kind === 'kpi_spark' ? widget.sparkline_period ?? undefined : undefined,
        },
      });
    } catch {
      return { rows: [], series: [], categories: [], total: 0, sparkline: [] };
    }
  }

  return { dashboards, loading, error, loadDashboards, mainDashboard, visibleDashboards, fetchWidgetData };
}
