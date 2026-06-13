<script setup lang="ts">
import type { Widget } from '~/types/dashboard';

const props = defineProps<{ widget: Widget }>();

const { fetchWidgetData } = useDashboards();

interface WidgetRow { label: string; value: number }
const rows = ref<WidgetRow[]>([]);
const total = ref(0);
const loading = ref(true);

onMounted(async () => {
  const res = await fetchWidgetData(props.widget);
  rows.value = res.rows;
  total.value = res.total;
  loading.value = false;
});

const isKpi = computed(() => props.widget.chart_kind === 'kpi_card');
const isTable = computed(() => props.widget.chart_kind === 'table');
const isPie = computed(() => ['pie', 'donut'].includes(props.widget.chart_kind));
const isBar = computed(() => ['bar', 'stacked_bar', 'stacked_bar_100'].includes(props.widget.chart_kind));

// For bar charts: scale bar widths relative to the max value.
const maxValue = computed(() => Math.max(1, ...rows.value.map((r) => r.value)));

// Threshold color for KPI card.
const kpiColor = computed(() => {
  if (!props.widget.thresholds?.length) return 'default';
  const sorted = [...props.widget.thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) {
    if (total.value >= t.value) return t.color;
  }
  return 'default';
});

const kpiColorClass: Record<string, string> = {
  success: 'text-green-600 dark:text-green-400',
  warning: 'text-amber-500 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
  default: 'text-primary',
};

// Progress toward target (0–1).
const progress = computed(() =>
  props.widget.target ? Math.min(1, total.value / props.widget.target) : null,
);

const BAR_COLORS = [
  'bg-primary',
  'bg-blue-400',
  'bg-emerald-500',
  'bg-amber-400',
  'bg-rose-400',
  'bg-purple-400',
  'bg-cyan-400',
  'bg-orange-400',
];
</script>

<template>
  <UCard class="h-full flex flex-col">
    <!-- Header -->
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm font-medium leading-tight">{{ widget.title }}</span>
        <UBadge size="xs" color="neutral" variant="subtle" class="font-mono shrink-0">{{ widget.chart_kind }}</UBadge>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center py-8">
      <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
    </div>

    <!-- Empty -->
    <div v-else-if="rows.length === 0" class="flex-1 flex items-center justify-center py-8">
      <p class="text-xs text-muted">No data</p>
    </div>

    <template v-else>
      <!-- KPI Card -->
      <div v-if="isKpi" class="flex-1 flex flex-col items-center justify-center py-4 gap-2">
        <span :class="['text-4xl font-bold tabular-nums', kpiColorClass[kpiColor]]">
          {{ total.toLocaleString() }}
        </span>
        <div v-if="widget.target" class="w-full space-y-1">
          <div class="w-full bg-muted rounded-full h-1.5">
            <div
              class="h-1.5 rounded-full transition-all"
              :class="kpiColor === 'success' ? 'bg-green-500' : kpiColor === 'error' ? 'bg-red-500' : 'bg-primary'"
              :style="{ width: `${(progress ?? 0) * 100}%` }"
            />
          </div>
          <p class="text-xs text-muted text-center">{{ total.toLocaleString() }} / {{ widget.target?.toLocaleString() }} target</p>
        </div>
      </div>

      <!-- Bar chart -->
      <div v-else-if="isBar" class="flex-1 space-y-1.5 py-2">
        <div v-for="(row, i) in rows" :key="row.label" class="space-y-0.5">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted truncate">{{ row.label }}</span>
            <span class="font-medium tabular-nums ml-2 shrink-0">{{ row.value.toLocaleString() }}</span>
          </div>
          <div class="w-full bg-muted rounded-full h-2">
            <div
              class="h-2 rounded-full transition-all"
              :class="BAR_COLORS[i % BAR_COLORS.length]"
              :style="{ width: `${(row.value / maxValue) * 100}%` }"
            />
          </div>
        </div>
      </div>

      <!-- Pie / Donut (legend only — no SVG dependency) -->
      <div v-else-if="isPie" class="flex-1 space-y-1.5 py-2">
        <div v-for="(row, i) in rows" :key="row.label" class="flex items-center gap-2 text-xs">
          <span class="size-2.5 rounded-full shrink-0" :class="BAR_COLORS[i % BAR_COLORS.length]" />
          <span class="text-muted flex-1 truncate">{{ row.label }}</span>
          <span class="font-medium tabular-nums">{{ row.value.toLocaleString() }}</span>
          <span class="text-muted">({{ total > 0 ? Math.round((row.value / total) * 100) : 0 }}%)</span>
        </div>
      </div>

      <!-- Table -->
      <div v-else-if="isTable" class="flex-1 overflow-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-default">
              <th class="text-left py-1.5 pr-3 font-medium text-muted">Label</th>
              <th class="text-right py-1.5 font-medium text-muted">Value</th>
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

      <!-- Line / Area / other (text table fallback) -->
      <div v-else class="flex-1 space-y-1 py-2">
        <div v-for="row in rows" :key="row.label" class="flex items-center justify-between text-xs">
          <span class="text-muted truncate">{{ row.label }}</span>
          <span class="font-medium tabular-nums ml-2 shrink-0">{{ row.value.toLocaleString() }}</span>
        </div>
      </div>

      <!-- Caption -->
      <p v-if="widget.caption" class="text-[10px] text-muted mt-2 border-t border-default pt-1">{{ widget.caption }}</p>
    </template>

    <!-- Footer: drill-down -->
    <template v-if="widget.drill_down" #footer>
      <NuxtLink :to="widget.drill_down" class="text-xs text-primary flex items-center gap-1 hover:underline">
        <UIcon name="i-lucide-arrow-right" class="size-3" />
        View details
      </NuxtLink>
    </template>
  </UCard>
</template>
