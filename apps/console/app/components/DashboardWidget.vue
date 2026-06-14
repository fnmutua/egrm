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

const isKpi   = computed(() => props.widget.chart_kind === 'kpi_card');
const isTable = computed(() => props.widget.chart_kind === 'table');
const isPie   = computed(() => ['pie', 'donut'].includes(props.widget.chart_kind));
const isBar   = computed(() => ['bar', 'stacked_bar', 'stacked_bar_100'].includes(props.widget.chart_kind));

const maxValue = computed(() => Math.max(1, ...rows.value.map((r) => r.value)));

const kpiColor = computed(() => {
  if (!props.widget.thresholds?.length) return 'default';
  const sorted = [...props.widget.thresholds].sort((a, b) => b.value - a.value);
  for (const t of sorted) {
    if (total.value >= t.value) return t.color;
  }
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
  warning: 'bg-amber-500/10 text-amber-500 dark:text-amber-400',
  error:   'bg-red-500/10 text-red-600 dark:text-red-400',
  default: 'bg-primary/10 text-primary',
};

const progress = computed(() =>
  props.widget.target ? Math.min(1, total.value / props.widget.target) : null,
);

const progressBarClass: Record<string, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error:   'bg-red-500',
  default: 'bg-primary',
};

const BAR_COLORS = [
  'bg-primary', 'bg-blue-400', 'bg-emerald-500', 'bg-amber-400',
  'bg-rose-400', 'bg-purple-400', 'bg-cyan-400', 'bg-orange-400',
];

const widgetIcon = computed(() => props.widget.icon || 'i-lucide-hash');
</script>

<template>
  <!-- ── KPI card: UPageCard-style with icon, big number, title ── -->
  <UPageCard
    v-if="isKpi"
    :to="widget.drill_down || undefined"
    class="h-full"
  >
    <div class="flex items-start justify-between gap-4">
      <!-- Number + label -->
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium text-muted truncate">{{ widget.title }}</p>

        <p v-if="loading" class="h-10 w-24 rounded bg-elevated animate-pulse" />
        <p v-else :class="['text-4xl font-bold tabular-nums leading-none', kpiNumberClass[kpiColor]]">
          {{ total.toLocaleString() }}
        </p>

        <p v-if="widget.caption && !loading" class="text-xs text-muted pt-0.5">{{ widget.caption }}</p>
      </div>

      <!-- Icon badge -->
      <div :class="['size-12 rounded-xl flex items-center justify-center shrink-0', kpiIconBg[kpiColor]]">
        <UIcon :name="widgetIcon" class="size-6" />
      </div>
    </div>

    <!-- Progress bar toward target -->
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

  <!-- ── All other chart types: plain UCard ── -->
  <UCard v-else class="h-full flex flex-col">
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm font-medium leading-tight">{{ widget.title }}</span>
        <UBadge size="xs" color="neutral" variant="subtle" class="font-mono shrink-0">{{ widget.chart_kind }}</UBadge>
      </div>
    </template>

    <div v-if="loading" class="flex-1 flex items-center justify-center py-8">
      <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
    </div>

    <div v-else-if="rows.length === 0" class="flex-1 flex items-center justify-center py-8">
      <p class="text-xs text-muted">No data</p>
    </div>

    <template v-else>
      <!-- Bar chart -->
      <div v-if="isBar" class="flex-1 space-y-1.5 py-2">
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

      <!-- Pie / Donut -->
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

      <!-- Line / Area / other (text list fallback) -->
      <div v-else class="flex-1 space-y-1 py-2">
        <div v-for="row in rows" :key="row.label" class="flex items-center justify-between text-xs">
          <span class="text-muted truncate">{{ row.label }}</span>
          <span class="font-medium tabular-nums ml-2 shrink-0">{{ row.value.toLocaleString() }}</span>
        </div>
      </div>

      <p v-if="widget.caption" class="text-[10px] text-muted mt-2 border-t border-default pt-1">{{ widget.caption }}</p>
    </template>

    <template v-if="widget.drill_down" #footer>
      <NuxtLink :to="widget.drill_down" class="text-xs text-primary flex items-center gap-1 hover:underline">
        <UIcon name="i-lucide-arrow-right" class="size-3" />
        View details
      </NuxtLink>
    </template>
  </UCard>
</template>
