<script setup lang="ts">
import type { Widget } from '~/types/dashboard';

const props = defineProps<{ widget: Widget }>();
const { fetchWidgetData } = useDashboards();
const colorMode = useColorMode();

interface WidgetRow { label: string; value: number }
const rows       = ref<WidgetRow[]>([]);
const seriesData = ref<{ name: string; data: number[] }[]>([]);
const categories = ref<string[]>([]);
const total      = ref(0);
const loading    = ref(true);

onMounted(async () => {
  const res = await fetchWidgetData(props.widget);
  rows.value       = res.rows ?? [];
  seriesData.value = res.series ?? [];
  categories.value = res.categories ?? [];
  total.value      = res.total;
  loading.value    = false;
});

const isMulti = computed(() => seriesData.value.length > 0);

function dimLabel(dim?: string): string {
  if (!dim) return '';
  if (dim.startsWith('unit_level:')) return dim.slice('unit_level:'.length).replace(/_/g, ' ');
  if (dim === 'unit_id') return 'Unit';
  return dim.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const isStacked = computed(() => ['stacked_bar', 'stacked_bar_100'].includes(props.widget.chart_kind));

const hasData = computed(() => {
  const kind = props.widget.chart_kind;
  if (kind === 'table') return rows.value.length > 0;
  if (isStacked.value || kind === 'multi_line' || kind === 'area') {
    return seriesData.value.length > 0 && categories.value.length > 0;
  }
  if (kind === 'line') return rows.value.length > 0;
  if (kind === 'pie' || kind === 'donut' || kind === 'bar') return rows.value.length > 0;
  return rows.value.length > 0 || isMulti.value;
});

const tableCategoryLabel = computed(() => dimLabel(props.widget.group_by?.[0]) || 'Label');

const chartEmptyHint = computed(() => {
  const gb = props.widget.group_by ?? [];
  const kind = props.widget.chart_kind;
  if (kind === 'table') {
    if (!gb[0]) return 'Pick a Rows dimension in the widget config.';
    return 'No matching cases for the current filters.';
  }
  if (isStacked.value) {
    if (!gb[0] || !gb[1]) return 'Set Categories (axis) and Series (stacks) in the widget config.';
    return 'No matching cases for the current filters.';
  }
  if (kind === 'bar' && !gb[0]) return 'Set Categories in the widget config.';
  if (kind === 'multi_line' || kind === 'area') {
    if (!props.widget.time_dimension || !props.widget.bucket) return 'Set Time dimension and Bucket in the widget config.';
    if (!gb[0]) return 'Set Series in the widget config.';
    return 'No matching cases for the current filters.';
  }
  if (kind === 'line') {
    if (!props.widget.time_dimension || !props.widget.bucket) return 'Set Time dimension and Bucket in the widget config.';
    return 'No matching cases for the current filters.';
  }
  return '';
});

const AGGREGATION_LABELS: Record<string, string> = {
  count: 'Count',
  count_distinct: 'Count distinct',
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  pct: 'Percentage',
};

const tableValueLabel = computed(() =>
  AGGREGATION_LABELS[props.widget.aggregation ?? 'count'] ?? 'Count',
);

const widgetSize = computed(() => props.widget.size ?? 'standard');
const isCompact = computed(() => widgetSize.value === 'compact');

const chartHeight = computed(() => {
  switch (widgetSize.value) {
    case 'compact': return 150;
    case 'wide': return 280;
    case 'full': return 340;
    default: return 220;
  }
});

// ── KPI threshold ──────────────────────────────────────────────
const kpiColor = computed(() => {
  if (!props.widget.thresholds?.length) return 'default';
  const sorted = [...props.widget.thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) if (total.value >= t.value) return t.color;
  return 'default';
});

const kpiNumberClass: Record<string, string> = {
  success: 'text-green-600 dark:text-green-400',
  warning: 'text-amber-500 dark:text-amber-400',
  error:   'text-red-600 dark:text-red-400',
  default: 'text-highlighted',
};
const kpiIconBg: Record<string, string> = {
  success: 'bg-green-500/10 text-green-600 dark:text-green-400',
  warning: 'bg-amber-500/10 text-amber-500',
  error:   'bg-red-500/10 text-red-600 dark:text-red-400',
  default: 'bg-primary/10 text-primary',
};
const progressBarClass: Record<string, string> = {
  success: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500', default: 'bg-primary',
};

const progress = computed(() =>
  props.widget.target ? Math.min(1, total.value / props.widget.target) : null,
);

// ── ApexCharts config ──────────────────────────────────────────
const isDark = computed(() => colorMode.value === 'dark');

// Palette that works on both themes
const PALETTE = [
  '#6366f1', '#22d3ee', '#34d399', '#f59e0b',
  '#f87171', '#a78bfa', '#38bdf8', '#fb923c',
];

const apexTheme = computed(() => ({
  mode: isDark.value ? 'dark' : 'light',
  palette: 'palette1',
}));

const baseOptions = computed(() => ({
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    zoom:    { enabled: false },
    animations: { enabled: true, speed: 400 },
    fontFamily: 'inherit',
  },
  theme: apexTheme.value,
  colors: PALETTE,
  grid: {
    borderColor: isDark.value ? '#334155' : '#e2e8f0',
    strokeDashArray: 4,
  },
  tooltip: { theme: isDark.value ? 'dark' : 'light' },
  dataLabels: { enabled: false },
  legend: {
    labels: { colors: isDark.value ? '#94a3b8' : '#64748b' },
  },
}));

const isKpi   = computed(() => props.widget.chart_kind === 'kpi_card');
const isBar   = computed(() => ['bar', 'stacked_bar', 'stacked_bar_100'].includes(props.widget.chart_kind));
const isLine  = computed(() => ['line', 'multi_line'].includes(props.widget.chart_kind));
const isArea  = computed(() => props.widget.chart_kind === 'area');
const isPie   = computed(() => props.widget.chart_kind === 'pie');
const isDonut = computed(() => props.widget.chart_kind === 'donut');
const isTable = computed(() => props.widget.chart_kind === 'table');

// X-axis labels: multi-series response provides `categories`; single-series uses row labels
const xAxisCategories = computed(() =>
  isMulti.value ? categories.value : rows.value.map((r) => r.label ?? '—')
);

const labelStyle = computed(() => ({
  colors: isDark.value ? '#94a3b8' : '#64748b',
  fontSize: isCompact.value ? '9px' : '11px',
}));

const compactLegend = computed(() => ({
  position: 'bottom' as const,
  fontSize: isCompact.value ? '10px' : '12px',
  ...baseOptions.value.legend,
  labels: { ...baseOptions.value.legend.labels, fontSize: isCompact.value ? '10px' : '12px' },
}));

const compactXaxisLabels = computed(() => ({
  style: labelStyle.value,
  rotate: isCompact.value ? -35 : -30,
  hideOverlappingLabels: true,
  trim: true,
  maxHeight: isCompact.value ? 36 : 60,
}));

// Build ApexCharts series + options per chart kind
const chartOptions = computed(() => {
  const pieLabels  = rows.value.map((r) => r.label ?? '—');
  const axisLabels = xAxisCategories.value;

  if (isPie.value || isDonut.value) {
    return {
      ...baseOptions.value,
      labels: pieLabels,
      chart: { ...baseOptions.value.chart, type: isDonut.value ? 'donut' : 'pie' },
      legend: { position: 'bottom', fontSize: isCompact.value ? '10px' : '12px', ...baseOptions.value.legend },
      plotOptions: {
        pie: {
          donut: { size: isCompact.value ? '55%' : '65%', labels: { show: isDonut.value && !isCompact.value, total: { show: !isCompact.value, label: 'Total', formatter: () => String(total.value) } } },
        },
      },
    };
  }

  if (isBar.value) {
    const stacked    = props.widget.chart_kind !== 'bar';
    const horizontal = !stacked || isCompact.value;
    const valueLabel = isCompact.value ? undefined : tableValueLabel.value;
    const axisTitle  = valueLabel ? { text: valueLabel, style: labelStyle.value } : undefined;
    return {
      ...baseOptions.value,
      chart: {
        ...baseOptions.value.chart,
        type: 'bar',
        stacked,
        stackType: props.widget.chart_kind === 'stacked_bar_100' ? '100%' : 'normal',
      },
      plotOptions: {
        bar: horizontal
          ? { horizontal: true, borderRadius: 3, barHeight: isCompact.value ? '70%' : '60%' }
          : { horizontal: false, borderRadius: 2, columnWidth: isCompact.value ? '75%' : '60%' },
      },
      legend: (stacked || isMulti.value) ? compactLegend.value : baseOptions.value.legend,
      xaxis: horizontal
        ? { categories: axisLabels, labels: compactXaxisLabels.value, title: axisTitle }
        : { categories: axisLabels, labels: compactXaxisLabels.value },
      yaxis: horizontal
        ? { labels: { style: labelStyle.value } }
        : { labels: { style: labelStyle.value }, title: axisTitle },
    };
  }

  if (isLine.value || isArea.value) {
    return {
      ...baseOptions.value,
      chart: { ...baseOptions.value.chart, type: isArea.value ? 'area' : 'line' },
      stroke: { curve: 'smooth', width: isCompact.value ? 1.5 : 2 },
      markers: { size: isCompact.value ? 0 : 3 },
      legend: isMulti.value ? compactLegend.value : baseOptions.value.legend,
      fill: isArea.value ? { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } } : undefined,
      xaxis: { categories: axisLabels, labels: compactXaxisLabels.value },
      yaxis: { labels: { style: labelStyle.value } },
    };
  }

  return baseOptions.value;
});

const chartSeries = computed(() => {
  if (isPie.value || isDonut.value) return rows.value.map((r) => r.value);
  if (isMulti.value) return seriesData.value;
  return [{ name: props.widget.title, data: rows.value.map((r) => r.value) }];
});

const chartType = computed(() => {
  if (isPie.value)          return 'pie';
  if (isDonut.value)        return 'donut';
  if (isBar.value)          return 'bar';
  if (isLine.value)         return 'line';
  if (isArea.value)         return 'area';
  return 'bar';
});

const widgetIcon = computed(() => props.widget.icon || 'i-lucide-hash');
</script>

<template>
  <!-- ── KPI Card ───────────────────────────────────────────── -->
  <UPageCard v-if="isKpi" class="h-full">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium text-muted truncate">{{ widget.title }}</p>
        <div v-if="loading" class="h-10 w-24 rounded bg-elevated animate-pulse" />
        <p v-else :class="['font-bold tabular-nums leading-none', isCompact ? 'text-3xl' : 'text-4xl', kpiNumberClass[kpiColor]]">
          {{ total.toLocaleString() }}
        </p>
      </div>
      <div :class="['size-12 rounded-xl flex items-center justify-center shrink-0', kpiIconBg[kpiColor]]">
        <UIcon :name="widgetIcon" class="size-6" />
      </div>
    </div>
    <div v-if="!loading && widget.target" class="mt-4 space-y-1.5">
      <div class="w-full bg-muted/50 rounded-full h-1.5 overflow-hidden">
        <div
          class="h-1.5 rounded-full transition-all duration-500"
          :class="progressBarClass[kpiColor]"
          :style="{ width: `${(progress ?? 0) * 100}%` }"
        />
      </div>
      <p class="text-xs text-muted">
        {{ total.toLocaleString() }} / {{ widget.target.toLocaleString() }} target
        <span class="ml-1 font-medium">{{ Math.round((progress ?? 0) * 100) }}%</span>
      </p>
    </div>
  </UPageCard>

  <!-- ── All other chart widgets ───────────────────────────── -->
  <UCard v-else class="h-full flex flex-col">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <UIcon v-if="widget.icon" :name="widget.icon" class="size-4 text-primary shrink-0" />
          <span class="text-sm font-medium truncate">{{ widget.title }}</span>
        </div>
        <UBadge size="xs" color="neutral" variant="subtle" class="font-mono shrink-0">
          {{ widget.chart_kind }}
        </UBadge>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center py-10">
      <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
    </div>

    <!-- No data -->
    <div v-else-if="!hasData" class="flex-1 flex flex-col items-center justify-center py-10 gap-1">
      <p class="text-xs text-muted">No data</p>
      <p v-if="chartEmptyHint" class="text-[10px] text-muted/80">{{ chartEmptyHint }}</p>
    </div>

    <template v-else>
      <!-- ApexCharts: bar, stacked bar, line, area, pie, donut -->
      <ClientOnly v-if="isBar || isLine || isArea || isPie || isDonut">
        <ApexChart
          width="100%"
          :height="chartHeight"
          :type="chartType"
          :options="chartOptions"
          :series="chartSeries"
        />
      </ClientOnly>

      <!-- Table -->
      <div v-else-if="isTable" class="flex-1 overflow-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-default">
              <th class="text-left py-1.5 pr-3 font-medium text-muted">{{ tableCategoryLabel }}</th>
              <th class="text-right py-1.5 font-medium text-muted">{{ tableValueLabel }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="row in rows" :key="row.label">
              <td class="py-1.5 pr-3 truncate text-muted">{{ row.label }}</td>
              <td class="py-1.5 text-right font-medium tabular-nums">{{ row.value.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Fallback text list -->
      <div v-else class="flex-1 space-y-1 py-2">
        <div v-for="row in rows" :key="row.label" class="flex items-center justify-between text-xs">
          <span class="text-muted truncate">{{ row.label }}</span>
          <span class="font-medium tabular-nums ml-2 shrink-0">{{ row.value.toLocaleString() }}</span>
        </div>
      </div>

    </template>
  </UCard>
</template>
