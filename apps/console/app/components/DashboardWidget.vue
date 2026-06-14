<script setup lang="ts">
import type { Widget } from '~/types/dashboard';
import { useDashboardUnitFilter } from '~/composables/useDashboardUnitFilter';

const props = defineProps<{ widget: Widget }>();
const { fetchWidgetData } = useDashboards();
const { effectiveUnitId } = useDashboardUnitFilter();
const colorMode = useColorMode();

interface WidgetRow { label: string; value: number }
const rows       = ref<WidgetRow[]>([]);
const seriesData = ref<{ name: string; data: number[] }[]>([]);
const categories = ref<string[]>([]);
const sparkline  = ref<WidgetRow[]>([]);
const total      = ref(0);
const loading    = ref(true);

async function loadData() {
  loading.value = true;
  try {
    const res = await fetchWidgetData(props.widget);
    rows.value       = res.rows ?? [];
    seriesData.value = res.series ?? [];
    categories.value = res.categories ?? [];
    sparkline.value  = res.sparkline ?? [];
    total.value      = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadData());

watch(effectiveUnitId, () => loadData());

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
  if (kind === 'gauge') return props.widget.target != null && props.widget.target > 0;
  if (kind === 'pie' || kind === 'donut' || kind === 'bar' || kind === 'treemap') return rows.value.length > 0;
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
  if (kind === 'treemap' && !gb[0]) return 'Set Tiles dimension in the widget config.';
  if (kind === 'gauge' && !(props.widget.target != null && props.widget.target > 0)) {
    return 'Set a Target in the widget config to compute %.';
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

const SPARKLINE_COLORS: Record<string, string> = {
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
  default: '#6366f1',
};

const sparklineColor = computed(() => SPARKLINE_COLORS[kpiColor.value] ?? SPARKLINE_COLORS.default);

const hasSparkline = computed(
  () => isKpiSpark.value && sparkline.value.length > 0,
);

/** Fixed spark slot so KPI Spark stays inside the card. */
const KPI_SPARK_SLOT_H = 28;

const sparklineOptions = computed(() => ({
  chart: {
    type: 'area' as const,
    sparkline: { enabled: true },
    animations: { enabled: true, speed: 500 },
    background: 'transparent',
    fontFamily: 'inherit',
    parentHeightOffset: 0,
    offsetX: 0,
    offsetY: 0,
  },
  grid: { padding: { left: 0, right: 0, top: 0, bottom: 0 } },
  theme: { mode: colorMode.value === 'dark' ? 'dark' : 'light' },
  stroke: { curve: 'smooth' as const, width: 1.5, colors: [sparklineColor.value] },
  fill: {
    type: 'gradient' as const,
    colors: [sparklineColor.value],
    gradient: { shadeIntensity: 0.9, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 100] },
  },
  tooltip: { enabled: false },
}));

const sparklineSeries = computed(() => [
  { name: props.widget.title, data: sparkline.value.map((r) => r.value) },
]);

const sparklinePeriodLabel = computed(() => {
  const labels: Record<string, string> = {
    '7d': 'Last 7 days',
    '14d': 'Last 14 days',
    '30d': 'Last 30 days',
    '8w': 'Last 8 weeks',
    '6m': 'Last 6 months',
  };
  return props.widget.sparkline_period ? labels[props.widget.sparkline_period] ?? '' : '';
});

const progress = computed(() =>
  props.widget.target ? Math.min(1, total.value / props.widget.target) : null,
);

const gaugePercent = computed(() => {
  if (!props.widget.target || props.widget.target <= 0) return null;
  return Math.min(100, Math.round((total.value / props.widget.target) * 1000) / 10);
});

const THRESHOLD_COLORS: Record<string, string> = {
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
  default: '#6366f1',
};

const gaugeColor = computed(() => {
  const pct = gaugePercent.value;
  if (pct == null) return THRESHOLD_COLORS.default;
  if (!props.widget.thresholds?.length) return THRESHOLD_COLORS.default;
  const sorted = [...props.widget.thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) if (pct >= t.value) return THRESHOLD_COLORS[t.color] ?? THRESHOLD_COLORS.default;
  return THRESHOLD_COLORS.default;
});

const gaugeVariant = computed(() => props.widget.gauge_variant ?? 'basic');
const gaugeIsSemiArc = computed(() => gaugeVariant.value === 'semi' || gaugeVariant.value === 'needle');
const gaugeIsNeedle = computed(() => gaugeVariant.value === 'needle');
const gaugeCenterLabel = computed(() => {
  if (gaugeVariant.value !== 'custom_label') return props.widget.title;
  return props.widget.gauge_label?.trim() || props.widget.title;
});

const needleRotation = computed(() => {
  const pct = gaugePercent.value ?? 0;
  return -90 + (pct / 100) * 180;
});

// ── ApexCharts config ──────────────────────────────────────────
const isDark = computed(() => colorMode.value === 'dark');

// Palette that works on both themes
const PALETTE = [
  '#6366f1', '#22d3ee', '#34d399', '#f59e0b',
  '#f87171', '#a78bfa', '#38bdf8', '#fb923c',
];

const apexTheme = computed(() => ({
  mode: isDark.value ? 'dark' : 'light',
  monochrome: { enabled: false },
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
  fill: {
    type: 'solid',
    colors: PALETTE,
  },
  stroke: {
    width: 2,
    colors: PALETTE,
  },
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

const isKpi   = computed(() => ['kpi_card', 'kpi_spark'].includes(props.widget.chart_kind));
const isKpiSpark = computed(() => props.widget.chart_kind === 'kpi_spark');
const isGauge = computed(() => props.widget.chart_kind === 'gauge');
const isBar   = computed(() => ['bar', 'stacked_bar', 'stacked_bar_100'].includes(props.widget.chart_kind));
const isLine  = computed(() => ['line', 'multi_line'].includes(props.widget.chart_kind));
const isArea  = computed(() => props.widget.chart_kind === 'area');
const isPie   = computed(() => props.widget.chart_kind === 'pie');
const isDonut = computed(() => props.widget.chart_kind === 'donut');
const isTreemap = computed(() => props.widget.chart_kind === 'treemap');
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

  if (isTreemap.value) {
    return {
      ...baseOptions.value,
      chart: { ...baseOptions.value.chart, type: 'treemap' },
      legend: { show: false },
      dataLabels: {
        enabled: true,
        style: {
          fontSize: isCompact.value ? '10px' : '11px',
          fontWeight: 500,
          colors: [isDark.value ? '#f1f5f9' : '#1e293b'],
        },
      },
      plotOptions: {
        treemap: {
          distributed: true,
          enableShades: true,
          shadeIntensity: 0.45,
        },
      },
      tooltip: {
        ...baseOptions.value.tooltip,
        y: { formatter: (v: number) => Number(v).toLocaleString() },
      },
    };
  }

  if (isGauge.value) {
    const pct = gaugePercent.value ?? 0;
    const target = props.widget.target ?? 0;
    const variant = gaugeVariant.value;
    const semi = gaugeIsSemiArc.value;
    const muted = isDark.value ? '#94a3b8' : '#64748b';
    const valueColor = isDark.value ? '#f1f5f9' : '#0f172a';

    const dataLabels = {
      name: {
        show: variant === 'custom_label',
        offsetY: semi ? -4 : -6,
        color: muted,
        fontSize: isCompact.value ? '10px' : '12px',
      },
      value: {
        show: variant !== 'needle',
        offsetY: semi ? 8 : 4,
        fontSize: isCompact.value ? '20px' : '28px',
        fontWeight: 700,
        color: valueColor,
        formatter: (val: number) => `${Math.round(val)}%`,
      },
      total: {
        show: variant === 'custom_label' || (variant === 'semi' && !isCompact.value),
        label: variant === 'custom_label' ? 'Actual' : '',
        fontSize: '11px',
        color: muted,
        formatter: () => `${total.value.toLocaleString()} / ${target.toLocaleString()}`,
      },
    };

    return {
      chart: {
        ...baseOptions.value.chart,
        type: 'radialBar',
        sparkline: { enabled: false },
      },
      theme: apexTheme.value,
      colors: [gaugeColor.value],
      plotOptions: {
        radialBar: {
          startAngle: semi ? -90 : -135,
          endAngle: semi ? 90 : 135,
          hollow: { size: isCompact.value ? '58%' : (variant === 'needle' ? '68%' : '62%') },
          track: {
            background: isDark.value ? '#334155' : '#e2e8f0',
            strokeWidth: '100%',
          },
          dataLabels,
        },
      },
      labels: [gaugeCenterLabel.value],
      stroke: { lineCap: 'round' },
      tooltip: {
        theme: isDark.value ? 'dark' : 'light',
        y: {
          formatter: () => `${pct}% (${total.value.toLocaleString()} of ${target.toLocaleString()})`,
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
    const lineOnly = !isArea.value;
    const { fill: _baseFill, ...lineBase } = baseOptions.value;
    return {
      ...lineBase,
      chart: { ...lineBase.chart, type: isArea.value ? 'area' : 'line' },
      stroke: {
        show: true,
        curve: 'smooth',
        width: isCompact.value ? 2 : 3,
        colors: PALETTE,
        lineCap: 'round',
      },
      markers: {
        size: lineOnly ? 0 : (isCompact.value ? 3 : 4),
        strokeWidth: 0,
        hover: { size: lineOnly ? 4 : 6 },
      },
      legend: isMulti.value ? compactLegend.value : { show: false },
      ...(isArea.value
        ? { fill: { type: 'gradient', colors: PALETTE, gradient: { opacityFrom: 0.4, opacityTo: 0.05 } } }
        : {}),
      plotOptions: {
        line: { isSlopeChart: false },
      },
      xaxis: { type: 'category', categories: axisLabels, labels: compactXaxisLabels.value },
      yaxis: { labels: { style: labelStyle.value }, min: 0 },
    };
  }

  return baseOptions.value;
});

const chartSeries = computed(() => {
  if (isGauge.value) return [gaugePercent.value ?? 0];
  if (isTreemap.value) {
    return [{ data: rows.value.map((r) => ({ x: r.label ?? '—', y: r.value })) }];
  }
  if (isPie.value || isDonut.value) return rows.value.map((r) => r.value);
  if (isMulti.value) return seriesData.value;
  return [{ name: props.widget.title, data: rows.value.map((r) => r.value) }];
});

const chartType = computed(() => {
  if (isGauge.value)        return 'radialBar';
  if (isPie.value)          return 'pie';
  if (isDonut.value)        return 'donut';
  if (isTreemap.value)      return 'treemap';
  if (isBar.value)          return 'bar';
  if (isLine.value)         return 'line';
  if (isArea.value)         return 'area';
  return 'bar';
});

const isApexChart = computed(() =>
  isBar.value || isLine.value || isArea.value || isPie.value || isDonut.value || isTreemap.value || isGauge.value,
);

const chartRef = ref<{ chart?: { dataURI: (opts?: { scale?: number }) => Promise<{ imgURI: string }> }; $el?: HTMLElement } | null>(null);

function exportFileBase() {
  const base = props.widget.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return base || 'chart';
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

async function exportChartPng() {
  await nextTick();
  const chart = chartRef.value?.chart;
  if (!chart?.dataURI) return;
  const { imgURI } = await chart.dataURI({ scale: 2 });
  triggerDownload(imgURI, `${exportFileBase()}.png`);
}

async function exportChartSvg() {
  await nextTick();
  const root = chartRef.value?.$el;
  const svgEl = root?.querySelector('.apexcharts-svg');
  if (!svgEl) return;
  const svg = new XMLSerializer().serializeToString(svgEl);
  triggerBlobDownload(
    new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' }),
    `${exportFileBase()}.svg`,
  );
}

function escapeCsvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function exportDataCsv() {
  let header: string[];
  let lines: string[];

  if (isMulti.value && categories.value.length) {
    header = ['Category', ...seriesData.value.map((s) => s.name)];
    lines = categories.value.map((cat, i) =>
      [escapeCsvCell(cat), ...seriesData.value.map((s) => s.data[i] ?? 0)].join(','),
    );
  } else {
    const labelCol = isTable.value
      ? tableCategoryLabel.value
      : (dimLabel(props.widget.group_by?.[0]) || 'Label');
    const valueCol = tableValueLabel.value;
    header = [labelCol, valueCol];
    lines = rows.value.map((r) => [escapeCsvCell(r.label), r.value].join(','));
  }

  const csv = [header.join(','), ...lines].join('\r\n');
  triggerBlobDownload(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    `${exportFileBase()}.csv`,
  );
}

const exportMenuItems = computed(() => {
  if (loading.value || !hasData.value) return [];
  const items: { label: string; icon: string; onSelect: () => void }[] = [];
  if (isApexChart.value) {
    items.push(
      { label: 'Download PNG', icon: 'i-lucide-image-down', onSelect: () => { void exportChartPng(); } },
      { label: 'Download SVG', icon: 'i-lucide-file-image', onSelect: () => { void exportChartSvg(); } },
      { label: 'Download CSV', icon: 'i-lucide-sheet', onSelect: exportDataCsv },
    );
  } else if (isTable.value) {
    items.push({ label: 'Download CSV', icon: 'i-lucide-sheet', onSelect: exportDataCsv });
  }
  return items;
});

const widgetIcon = computed(() => props.widget.icon || 'i-lucide-hash');
</script>

<template>
  <!-- ── KPI Card / KPI Spark ─────────────────────────────── -->
  <UPageCard v-if="isKpi" class="h-full overflow-hidden">
    <div class="min-w-0 overflow-hidden">
      <p class="text-sm font-medium text-muted truncate">{{ widget.title }}</p>
      <div class="mt-1 flex items-end gap-2 min-w-0" :class="isKpiSpark ? '' : 'justify-between'">
        <div class="shrink-0">
          <div v-if="loading" class="h-10 w-20 rounded bg-elevated animate-pulse" />
          <p
            v-else
            :class="['font-bold tabular-nums leading-none', isCompact ? 'text-3xl' : 'text-4xl', kpiNumberClass[kpiColor]]"
          >
            {{ total.toLocaleString() }}
          </p>
        </div>

        <div
          v-if="isKpiSpark"
          class="flex-1 min-w-0 overflow-hidden h-7"
        >
          <div v-if="loading" class="h-full w-full rounded bg-elevated animate-pulse" />
          <div v-else-if="hasSparkline" class="h-full w-full overflow-hidden">
            <ClientOnly>
              <ApexChart
                :key="`${widget.id}-spark-${sparkline.length}-${total}`"
                width="100%"
                :height="KPI_SPARK_SLOT_H"
                type="area"
                :options="sparklineOptions"
                :series="sparklineSeries"
              />
            </ClientOnly>
          </div>
        </div>

        <div :class="['size-12 rounded-xl flex items-center justify-center shrink-0', kpiIconBg[kpiColor]]">
          <UIcon :name="widgetIcon" class="size-6" />
        </div>
      </div>
      <p
        v-if="isKpiSpark && !loading && hasSparkline && sparklinePeriodLabel"
        class="mt-1 text-[9px] text-muted leading-none truncate"
      >
        {{ sparklinePeriodLabel }}
      </p>
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
        <UDropdownMenu v-if="exportMenuItems.length" :items="exportMenuItems">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-download"
            aria-label="Download chart"
          />
        </UDropdownMenu>
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
      <!-- Gauge (optional needle overlay) -->
      <ClientOnly v-if="isGauge">
        <div class="relative w-full" :style="{ height: `${chartHeight}px` }">
          <ApexChart
            :key="`${widget.id}-${gaugeVariant}-${gaugePercent}`"
            ref="chartRef"
            width="100%"
            :height="chartHeight"
            type="radialBar"
            :options="chartOptions"
            :series="chartSeries"
          />
          <div
            v-if="gaugeIsNeedle"
            class="absolute inset-0 flex flex-col items-center justify-end pb-[12%] pointer-events-none"
          >
            <div class="relative w-28 h-14 mb-1">
              <div
                class="absolute bottom-0 left-1/2 w-1 origin-bottom -ml-0.5 rounded-full transition-transform duration-500 shadow-sm"
                :style="{
                  height: isCompact ? '52px' : '64px',
                  transform: `rotate(${needleRotation}deg)`,
                  backgroundColor: gaugeColor,
                }"
              />
              <div
                class="absolute bottom-0 left-1/2 -translate-x-1/2 size-3.5 rounded-full border-2 border-background shadow-sm"
                :style="{ backgroundColor: gaugeColor }"
              />
            </div>
            <p class="text-xl font-bold tabular-nums" :class="isDark ? 'text-highlighted' : 'text-default'">
              {{ gaugePercent }}%
            </p>
            <p class="text-[11px] text-muted tabular-nums">
              {{ total.toLocaleString() }} / {{ widget.target?.toLocaleString() }}
            </p>
          </div>
        </div>
      </ClientOnly>

      <!-- ApexCharts: bar, stacked bar, line, area, pie, donut, treemap -->
      <ClientOnly v-else-if="isBar || isLine || isArea || isPie || isDonut || isTreemap">
        <ApexChart
          :key="`${widget.id}-${rows.length}-${seriesData.length}`"
          ref="chartRef"
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
