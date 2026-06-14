<script setup lang="ts">
/**
 * CD-15 Dashboards — three subsection views:
 *   sec-dashboards  → card grid of dashboards; click to expand settings
 *   sec-sections    → section list for active dashboard; click to expand settings
 *   sec-widgets     → widget list for active section; click to expand editor
 *
 * activeDashId / activeSectionId persist across subsection navigation.
 */

// ---- Types ----

interface FilterDef { field: string; op: string; value: unknown }
interface Threshold { value: number; color: 'success' | 'warning' | 'error'; label?: string }
interface Metric { measure: string; aggregation: string; label: string }

interface Widget {
  id: string; title: string; chart_kind: string; dataset: string;
  measure: string; aggregation: string; metrics: Metric[];
  group_by: string[]; time_dimension?: string; bucket?: string;
  filters: FilterDef[]; target?: number | null;
  thresholds: Threshold[]; drill_down?: string | null; caption?: string | null;
}

interface Section {
  id: string; title: string; icon?: string; color?: string; order: number; widgets: Widget[];
}

interface Dashboard {
  id: string; title: string; icon?: string;
  audience: { roles: string[]; levels: string[] };
  is_main: boolean; is_public: boolean; layout: string;
  filter_bar: { period: boolean; unit: boolean; category: boolean };
  sections: Section[];
}

// ---- Constants ----

const DATASETS = [
  { value: 'cases', label: 'Cases' }, { value: 'case_events', label: 'Case events' },
  { value: 'sla_clocks', label: 'SLA clocks' }, { value: 'satisfaction', label: 'Satisfaction' },
  { value: 'cases_sensitive_aggregate', label: 'Sensitive aggregate' },
];
const CHART_KINDS = [
  { value: 'kpi_card', label: 'KPI Card', icon: 'i-lucide-square-dashed' },
  { value: 'bar', label: 'Bar', icon: 'i-lucide-bar-chart-2' },
  { value: 'stacked_bar', label: 'Stacked bar', icon: 'i-lucide-bar-chart' },
  { value: 'stacked_bar_100', label: 'Stacked 100%', icon: 'i-lucide-bar-chart' },
  { value: 'line', label: 'Line', icon: 'i-lucide-trending-up' },
  { value: 'multi_line', label: 'Multi-line', icon: 'i-lucide-activity' },
  { value: 'area', label: 'Area', icon: 'i-lucide-area-chart' },
  { value: 'pie', label: 'Pie', icon: 'i-lucide-pie-chart' },
  { value: 'donut', label: 'Donut', icon: 'i-lucide-circle-dashed' },
  { value: 'treemap', label: 'Treemap', icon: 'i-lucide-layout-grid' },
  { value: 'map', label: 'Map', icon: 'i-lucide-map' },
  { value: 'table', label: 'Table', icon: 'i-lucide-table' },
  { value: 'pyramid', label: 'Pyramid', icon: 'i-lucide-triangle' },
];
const AGGREGATIONS = [
  { value: 'count', label: 'Count' }, { value: 'count_distinct', label: 'Count distinct' },
  { value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' }, { value: 'pct', label: 'Percentage' },
];
const DIMENSIONS = [
  { value: 'category', label: 'Category' }, { value: 'status_tag', label: 'Status tag' },
  { value: 'channel', label: 'Channel' }, { value: 'priority', label: 'Priority' },
  { value: 'sensitivity', label: 'Sensitivity' },
  { value: 'unit_level_1', label: 'Unit L1' }, { value: 'unit_level_2', label: 'Unit L2' }, { value: 'unit_level_3', label: 'Unit L3' },
  { value: 'time_bucket', label: 'Time bucket' }, { value: 'assignee', label: 'Assignee' }, { value: 'team', label: 'Team' },
];
const TIME_DIMENSIONS = [
  { value: 'submitted_at', label: 'Submitted at' }, { value: 'resolved_at', label: 'Resolved at' },
  { value: 'closed_at', label: 'Closed at' }, { value: 'acknowledged_at', label: 'Acknowledged at' },
  { value: 'first_response_at', label: 'First response at' },
];
const TIME_BUCKETS = [
  { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' },
];
const FILTER_OPS = [
  { value: 'eq', label: '= equals' }, { value: 'neq', label: '≠ not equals' },
  { value: 'in', label: 'in list' }, { value: 'nin', label: 'not in list' },
  { value: 'lt', label: '< less than' }, { value: 'gt', label: '> greater than' }, { value: 'between', label: 'between' },
];
const FILTER_FIELDS = [
  { value: 'status',      label: 'Status' },
  { value: 'status_tag',  label: 'Status tag' },
  { value: 'channel',     label: 'Channel' },
  { value: 'priority',    label: 'Priority' },
  { value: 'sensitivity', label: 'Sensitivity' },
  { value: 'category',    label: 'Category' },
  { value: 'level_code',  label: 'Level' },
  { value: 'anonymous',   label: 'Anonymous' },
  { value: 'unit_id',     label: 'Unit ID' },
];
// What input type to show for each filterable field
const FIELD_TYPE: Record<string, 'enum' | 'bool' | 'text' | 'number' | 'date'> = {
  status:      'enum',
  status_tag:  'enum',
  channel:     'enum',
  priority:    'enum',
  sensitivity: 'enum',
  category:    'enum',
  level_code:  'enum',
  anonymous:   'bool',
  unit_id:     'text',
};
const LAYOUT_OPTIONS = [{ value: 'grid', label: 'Grid' }, { value: 'single_col', label: 'Single column' }];
const THRESHOLD_COLORS = [{ value: 'success', label: 'Green' }, { value: 'warning', label: 'Amber' }, { value: 'error', label: 'Red' }];

const DEFAULT_PACK = [
  { title: 'Operational', icon: 'i-lucide-clipboard-list', audience: { roles: [], levels: [] }, is_main: true, is_public: false, layout: 'grid', filter_bar: { period: true, unit: true, category: false }, sections: [] },
  { title: 'Management', icon: 'i-lucide-bar-chart-2', audience: { roles: [], levels: [] }, is_main: false, is_public: false, layout: 'grid', filter_bar: { period: true, unit: true, category: true }, sections: [] },
  { title: 'Transparency', icon: 'i-lucide-globe', audience: { roles: [], levels: [] }, is_main: false, is_public: true, layout: 'grid', filter_bar: { period: true, unit: false, category: false }, sections: [] },
];

// ---- Props & state ----

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { roleNames, loadRoleNames } = useTenantRoles();
const { api } = useApi();

// Field value cache for filter autocomplete
const fieldValuesCache = reactive<Record<string, string[]>>({});
const fieldValuesLoading = reactive<Record<string, boolean>>({});

async function ensureFieldValues(field: string) {
  if (fieldValuesCache[field] !== undefined || fieldValuesLoading[field]) return;
  fieldValuesLoading[field] = true;
  try {
    const res = await api<{ values: string[] }>(`/api/v1/dashboards/field-values?field=${encodeURIComponent(field)}&dataset=cases`);
    fieldValuesCache[field] = res.values;
  } catch {
    fieldValuesCache[field] = [];
  } finally {
    fieldValuesLoading[field] = false;
  }
}

function fvItems(field: string): string[] { return fieldValuesCache[field] ?? []; }
function fieldType(field: string) { return FIELD_TYPE[field] ?? 'text'; }
function valueAsArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

onMounted(async () => { await loadRoleNames(); ensure(); });

function ensure() {
  props.payload.dashboards ??= [];
  for (const d of props.payload.dashboards as Dashboard[]) {
    d.audience ??= { roles: [], levels: [] };
    d.audience.roles ??= []; d.audience.levels ??= [];
    d.is_main ??= false; d.is_public ??= false; d.layout ??= 'grid';
    d.filter_bar ??= { period: true, unit: true, category: false };
    d.sections ??= [];
    for (const s of d.sections) {
      s.widgets ??= [];
      for (const w of s.widgets) { w.metrics ??= []; w.group_by ??= []; w.filters ??= []; w.thresholds ??= []; }
    }
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const dashboards = computed<Dashboard[]>(() => props.payload.dashboards);

// Shared context — persists across subsection navigation
const activeDashId = ref<string | null>(null);
const activeSectionId = ref<string | null>(null);
const expandedWidgetId = ref<string | null>(null);

const activeDash = computed(() => dashboards.value.find((d) => d.id === activeDashId.value) ?? dashboards.value[0] ?? null);
const activeSection = computed(() => activeDash.value?.sections.find((s) => s.id === activeSectionId.value) ?? activeDash.value?.sections[0] ?? null);

// Pre-load enum values reactively whenever the expanded widget's filters change
watchEffect(() => {
  if (!expandedWidgetId.value || !activeSection.value) return;
  const w = activeSection.value.widgets.find((x) => x.id === expandedWidgetId.value);
  for (const f of w?.filters ?? []) {
    if (f.field && fieldType(f.field) === 'enum') ensureFieldValues(f.field);
  }
});

watch(dashboards, (ds) => {
  if (!activeDashId.value && ds.length) activeDashId.value = ds[0].id;
  if (activeDashId.value && !ds.find((d) => d.id === activeDashId.value)) activeDashId.value = ds[0]?.id ?? null;
}, { immediate: true });

watch(activeDash, (d) => {
  if (!activeSectionId.value && d?.sections.length) activeSectionId.value = d.sections[0].id;
  if (activeSectionId.value && !d?.sections.find((s) => s.id === activeSectionId.value)) activeSectionId.value = d?.sections[0]?.id ?? null;
}, { immediate: true });

// ---- CRUD ----

function uid() { return Math.random().toString(36).slice(2, 9); }

function addDashboard() {
  const id = `dash-${uid()}`;
  props.payload.dashboards.push({ id, title: 'Dashboard', icon: 'i-lucide-layout-dashboard', audience: { roles: [], levels: [] }, is_main: false, is_public: false, layout: 'grid', filter_bar: { period: true, unit: true, category: false }, sections: [] });
  activeDashId.value = id;
}

function removeDashboard(dash: Dashboard) {
  props.payload.dashboards = dashboards.value.filter((d) => d.id !== dash.id);
  activeDashId.value = dashboards.value[0]?.id ?? null;
}

function loadDefaultPack() {
  const firstId = `dash-${uid()}`;
  let first = true;
  for (const tpl of DEFAULT_PACK) {
    const id = first ? firstId : `dash-${uid()}`;
    props.payload.dashboards.push({ id, ...structuredClone(tpl) });
    first = false;
  }
  activeDashId.value = firstId;
}

function addSection(dash: Dashboard) {
  const id = `sec-${uid()}`;
  dash.sections.push({ id, title: 'New section', icon: '', color: '', order: dash.sections.length, widgets: [] });
  activeSectionId.value = id;
}

function removeSection(dash: Dashboard, sec: Section) {
  dash.sections = dash.sections.filter((s) => s.id !== sec.id);
  if (activeSectionId.value === sec.id) activeSectionId.value = dash.sections[0]?.id ?? null;
}

function moveSectionUp(dash: Dashboard, i: number) {
  if (i === 0) return;
  [dash.sections[i - 1], dash.sections[i]] = [dash.sections[i]!, dash.sections[i - 1]!];
}

function moveSectionDown(dash: Dashboard, i: number) {
  if (i >= dash.sections.length - 1) return;
  [dash.sections[i], dash.sections[i + 1]] = [dash.sections[i + 1]!, dash.sections[i]!];
}

function addWidget(sec: Section) {
  const id = `w-${uid()}`;
  sec.widgets.push({ id, title: 'New widget', chart_kind: 'kpi_card', dataset: 'cases', measure: 'id', aggregation: 'count', metrics: [], group_by: [], filters: [], thresholds: [] });
  expandedWidgetId.value = id;
}

function removeWidget(sec: Section, w: Widget) {
  sec.widgets = sec.widgets.filter((x) => x.id !== w.id);
  if (expandedWidgetId.value === w.id) expandedWidgetId.value = null;
}

function toggleWidget(id: string) { expandedWidgetId.value = expandedWidgetId.value === id ? null : id; }

function addMetric(w: Widget) { w.metrics.push({ measure: 'id', aggregation: 'count', label: '' }); }
function removeMetric(w: Widget, i: number) { w.metrics.splice(i, 1); }
function addFilter(w: Widget) { w.filters.push({ field: 'status', op: 'eq', value: '' }); ensureFieldValues('status'); }
function removeFilter(w: Widget, i: number) { w.filters.splice(i, 1); }
function addThreshold(w: Widget) { w.thresholds.push({ value: 0, color: 'warning', label: '' }); }
function removeThreshold(w: Widget, i: number) { w.thresholds.splice(i, 1); }

const isMultiSeries = (k: string) => ['multi_line', 'stacked_bar', 'stacked_bar_100', 'area'].includes(k);
const needsTimeDim = (k: string) => ['line', 'multi_line', 'area'].includes(k);
const chartIcon = (k: string) => CHART_KINDS.find((c) => c.value === k)?.icon ?? 'i-lucide-bar-chart-2';
const datasetLabel = (v: string) => DATASETS.find((d) => d.value === v)?.label ?? v;

// Dashboard selector strip used on Sections + Widgets pages
const dashTabClass = (id: string) => [
  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer select-none',
  activeDashId.value === id ? 'bg-primary text-inverted' : 'text-muted hover:text-default hover:bg-elevated/60',
].join(' ');
</script>

<template>
  <div>

    <!-- ══════════════════════════════════════════════════════════ -->
    <!--  DASHBOARDS                                               -->
    <!-- ══════════════════════════════════════════════════════════ -->
    <template v-if="!section || section === 'sec-dashboards'">

      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-muted">{{ dashboards.length }} dashboard{{ dashboards.length !== 1 ? 's' : '' }}</span>
        <div class="flex gap-2">
          <UButton size="xs" variant="outline" icon="i-lucide-package" @click="loadDefaultPack">Load defaults</UButton>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addDashboard">Add</UButton>
        </div>
      </div>

      <div v-if="dashboards.length === 0" class="py-10 text-center text-sm text-muted">
        No dashboards yet.
      </div>

      <div v-else class="divide-y divide-default">
        <div v-for="dash in dashboards" :key="dash.id">
          <!-- Summary row -->
          <div
            class="flex items-center gap-3 px-0 py-2.5 cursor-pointer hover:bg-elevated/40 transition"
            @click="activeDashId = activeDashId === dash.id ? null : dash.id"
          >
            <UIcon :name="dash.icon || 'i-lucide-layout-dashboard'" class="size-4 text-muted shrink-0" />
            <span class="text-sm font-medium flex-1">{{ dash.title }}</span>
            <span class="text-xs text-muted">{{ dash.sections.length }} sections · {{ dash.sections.reduce((n, s) => n + s.widgets.length, 0) }} widgets</span>
            <UBadge v-if="dash.is_main" size="xs" color="neutral" variant="subtle">Main</UBadge>
            <UBadge v-if="dash.is_public" size="xs" color="neutral" variant="subtle">Public</UBadge>
            <UIcon :name="activeDashId === dash.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted shrink-0" />
          </div>

          <!-- Expanded form -->
          <div v-if="activeDashId === dash.id" class="py-4 space-y-4" @click.stop>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <UFormField label="Title" help="One word, max 20 chars">
                <UInput v-model="dash.title" maxlength="20" @input="dash.title = dash.title.replace(/\s+/g, '')" />
              </UFormField>
              <UFormField label="Icon" help="Lucide token, e.g. i-lucide-bar-chart-2">
                <UInput v-model="dash.icon" class="font-mono text-xs" placeholder="i-lucide-layout-dashboard" />
              </UFormField>
              <UFormField label="Layout">
                <USelectMenu v-model="dash.layout" :items="LAYOUT_OPTIONS" value-key="value" label-key="label" class="w-full" />
              </UFormField>
              <UFormField label="Audience — roles" help="Empty = all roles">
                <USelectMenu v-model="dash.audience.roles" :items="roleNames" multiple placeholder="All roles" class="w-full" />
              </UFormField>
              <UFormField label="Filter bar">
                <div class="flex flex-wrap gap-4 mt-1">
                  <label class="flex items-center gap-1.5 text-sm cursor-pointer"><UCheckbox v-model="dash.filter_bar.period" /> Period</label>
                  <label class="flex items-center gap-1.5 text-sm cursor-pointer"><UCheckbox v-model="dash.filter_bar.unit" /> Unit</label>
                  <label class="flex items-center gap-1.5 text-sm cursor-pointer"><UCheckbox v-model="dash.filter_bar.category" /> Category</label>
                </div>
              </UFormField>
              <div class="flex flex-col gap-2 justify-center">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <USwitch v-model="dash.is_main" size="sm" /> Main (post-login landing)
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <USwitch v-model="dash.is_public" size="sm" /> Public transparency
                </label>
              </div>
            </div>
            <div class="flex justify-end pt-1">
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeDashboard(dash)">Delete</UButton>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ══════════════════════════════════════════════════════════ -->
    <!--  SECTIONS                                                 -->
    <!-- ══════════════════════════════════════════════════════════ -->
    <template v-else-if="section === 'sec-sections'">

      <div v-if="dashboards.length === 0" class="text-sm text-muted py-8 text-center">
        No dashboards yet. <NuxtLink to="#sec-dashboards" class="text-primary underline">Create one first.</NuxtLink>
      </div>

      <template v-else>
        <!-- Dashboard tabs -->
        <div class="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-default">
          <button v-for="dash in dashboards" :key="dash.id" :class="dashTabClass(dash.id)"
            @click="activeDashId = dash.id; activeSectionId = null">
            <UIcon :name="dash.icon || 'i-lucide-layout-dashboard'" class="size-3.5 shrink-0" />
            <span class="max-w-[120px] truncate">{{ dash.title }}</span>
          </button>
        </div>

        <div v-if="activeDash">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs text-muted">{{ activeDash.sections.length }} section{{ activeDash.sections.length !== 1 ? 's' : '' }}</span>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addSection(activeDash)">Add section</UButton>
          </div>

          <div v-if="activeDash.sections.length === 0" class="py-8 text-center text-sm text-muted">No sections yet.</div>

          <div v-else class="divide-y divide-default">
            <div v-for="(sec, idx) in activeDash.sections" :key="sec.id">
              <!-- Section row -->
              <div
                class="flex items-center gap-3 px-0 py-2.5 cursor-pointer hover:bg-elevated/40 transition"
                @click="activeSectionId = activeSectionId === sec.id ? null : sec.id"
              >
                <UIcon :name="sec.icon || 'i-lucide-rows-3'" class="size-4 text-muted shrink-0" />
                <input
                  v-model="sec.title"
                  class="text-sm font-medium flex-1 bg-transparent outline-none cursor-text min-w-0"
                  placeholder="Section title"
                  @click.stop
                  @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                />
                <span class="text-xs text-muted shrink-0">{{ sec.widgets.length }} widget{{ sec.widgets.length !== 1 ? 's' : '' }}</span>
                <div class="flex items-center gap-0.5 shrink-0" @click.stop>
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-up" :disabled="idx === 0" @click="moveSectionUp(activeDash, idx)" />
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :disabled="idx === activeDash.sections.length - 1" @click="moveSectionDown(activeDash, idx)" />
                  <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeSection(activeDash, sec)" />
                </div>
                <UIcon :name="activeSectionId === sec.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted shrink-0" />
              </div>

              <!-- Expanded appearance -->
              <div v-if="activeSectionId === sec.id" class="py-4 grid grid-cols-1 sm:grid-cols-2 gap-4" @click.stop>
                <UFormField label="Icon" help="Lucide token">
                  <UInput v-model="sec.icon" class="w-full font-mono text-xs" placeholder="i-lucide-rows-3" />
                </UFormField>
                <UFormField label="Accent color">
                  <UInput v-model="sec.color" class="w-full" placeholder="primary / #hex" />
                </UFormField>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- ══════════════════════════════════════════════════════════ -->
    <!--  WIDGETS                                                  -->
    <!-- ══════════════════════════════════════════════════════════ -->
    <template v-else-if="section === 'sec-widgets'">

      <div v-if="dashboards.length === 0" class="text-sm text-muted py-8 text-center">
        No dashboards yet. <NuxtLink to="#sec-dashboards" class="text-primary underline">Create one first.</NuxtLink>
      </div>

      <template v-else>
        <!-- Dashboard + section selectors -->
        <div class="space-y-3 mb-4 pb-3 border-b border-default">
          <div>
            <p class="text-xs text-muted mb-1.5">Dashboard</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="dash in dashboards" :key="dash.id" :class="dashTabClass(dash.id)"
                @click="activeDashId = dash.id; activeSectionId = null; expandedWidgetId = null">
                <UIcon :name="dash.icon || 'i-lucide-layout-dashboard'" class="size-3.5 shrink-0" />
                <span class="max-w-[110px] truncate">{{ dash.title }}</span>
              </button>
            </div>
          </div>
          <div v-if="activeDash?.sections.length">
            <p class="text-xs text-muted mb-1.5">Section</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sec in activeDash.sections"
                :key="sec.id"
                class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer select-none"
                :class="activeSectionId === sec.id ? 'bg-elevated border border-default text-default' : 'text-muted hover:text-default hover:bg-elevated/60'"
                @click="activeSectionId = sec.id; expandedWidgetId = null"
              >
                <UIcon :name="sec.icon || 'i-lucide-rows-3'" class="size-3.5 shrink-0" />
                <span class="max-w-[110px] truncate">{{ sec.title }}</span>
                <span class="text-xs text-muted">{{ sec.widgets.length }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="activeDash && !activeDash.sections.length" class="py-8 text-center text-sm text-muted">
          No sections in <strong>{{ activeDash.title }}</strong>.
          <NuxtLink to="#sec-sections" class="text-primary underline ml-1">Add sections first.</NuxtLink>
        </div>

        <template v-else-if="activeSection">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs text-muted">{{ activeSection.widgets.length }} widget{{ activeSection.widgets.length !== 1 ? 's' : '' }}</span>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addWidget(activeSection)">Add widget</UButton>
          </div>

          <div v-if="activeSection.widgets.length === 0" class="py-8 text-center text-sm text-muted">No widgets yet.</div>

          <div v-else class="divide-y divide-default">
            <div v-for="widget in activeSection.widgets" :key="widget.id">

              <!-- Widget row -->
              <div
                class="flex items-center gap-3 px-0 py-2.5 cursor-pointer hover:bg-elevated/40 transition"
                @click="toggleWidget(widget.id)"
              >
                <UIcon :name="chartIcon(widget.chart_kind)" class="size-4 text-muted shrink-0" />
                <span class="text-sm font-medium flex-1 truncate">{{ widget.title || '(untitled)' }}</span>
                <span class="text-xs text-muted shrink-0">{{ widget.chart_kind }}</span>
                <span class="text-xs text-muted shrink-0">{{ datasetLabel(widget.dataset) }}</span>
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeWidget(activeSection, widget)" />
                <UIcon :name="expandedWidgetId === widget.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted shrink-0" />
              </div>

              <!-- Widget editor -->
              <div v-if="expandedWidgetId === widget.id" class="py-4 space-y-4">

                <!-- Identity -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <UFormField label="Title"><UInput v-model="widget.title" class="w-full" /></UFormField>
                  <UFormField label="Chart type">
                    <USelectMenu v-model="widget.chart_kind" :items="CHART_KINDS" value-key="value" label-key="label" class="w-full" />
                  </UFormField>
                  <UFormField label="Dataset">
                    <USelectMenu v-model="widget.dataset" :items="DATASETS" value-key="value" label-key="label" class="w-full" />
                  </UFormField>
                </div>

                <!-- Data -->
                <div class="space-y-3 pt-4 border-t border-default/60">
                  <p class="text-[11px] font-semibold text-muted uppercase tracking-wider">Data</p>
                  <template v-if="!isMultiSeries(widget.chart_kind)">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <UFormField label="Measure" help="e.g. id, resolution_hours">
                        <UInput v-model="widget.measure" class="w-full font-mono" placeholder="id" />
                      </UFormField>
                      <UFormField label="Aggregation">
                        <USelectMenu v-model="widget.aggregation" :items="AGGREGATIONS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-muted">Series</span>
                      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addMetric(widget)">Add series</UButton>
                    </div>
                    <p v-if="widget.metrics.length === 0" class="text-xs text-muted italic">No series yet.</p>
                    <div v-for="(m, mi) in widget.metrics" :key="mi" class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50">
                      <UFormField label="Measure"><UInput v-model="m.measure" class="w-full font-mono text-xs" placeholder="id" /></UFormField>
                      <UFormField label="Aggregation"><USelectMenu v-model="m.aggregation" :items="AGGREGATIONS" value-key="value" label-key="label" class="w-full" /></UFormField>
                      <UFormField label="Label"><UInput v-model="m.label" class="w-full" placeholder="e.g. Resolved" /></UFormField>
                      <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeMetric(widget, mi)" />
                    </div>
                  </template>
                  <UFormField label="Group by" help="Split results by dimension.">
                    <USelectMenu v-model="widget.group_by" :items="DIMENSIONS" value-key="value" label-key="label" multiple placeholder="No grouping — aggregate all" class="w-full" />
                  </UFormField>
                  <template v-if="needsTimeDim(widget.chart_kind)">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <UFormField label="Time dimension">
                        <USelectMenu v-model="widget.time_dimension" :items="TIME_DIMENSIONS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                      <UFormField label="Bucket">
                        <USelectMenu v-model="widget.bucket" :items="TIME_BUCKETS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                    </div>
                  </template>
                </div>

                <!-- Filters -->
                <div class="space-y-2 pt-4 border-t border-default/60">
                  <div class="flex items-center justify-between">
                    <p class="text-[11px] font-semibold text-muted uppercase tracking-wider">Filters</p>
                    <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addFilter(widget)">Add</UButton>
                  </div>
                  <p v-if="widget.filters.length === 0" class="text-xs text-muted italic">No filters — widget shows all records.</p>
                  <div v-for="(f, fi) in widget.filters" :key="fi" class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50">
                    <UFormField label="Field">
                      <USelectMenu
                        v-model="f.field"
                        :items="FILTER_FIELDS"
                        value-key="value"
                        label-key="label"
                        class="w-full"
                        @update:model-value="(v) => { f.value = ''; if (fieldType(v) === 'enum') ensureFieldValues(v); }"
                      />
                    </UFormField>
                    <UFormField label="Operator">
                      <USelectMenu v-model="f.op" :items="FILTER_OPS" value-key="value" label-key="label" class="w-full" />
                    </UFormField>
                    <UFormField label="Value">
                      <!-- ENUM: multi-select for in/nin, single-select for eq/neq, text for lt/gt/between -->
                      <template v-if="fieldType(f.field) === 'enum'">
                        <USelectMenu
                          v-if="['in', 'nin'].includes(f.op)"
                          :model-value="valueAsArray(f.value)"
                          :items="fvItems(f.field)"
                          multiple
                          placeholder="Pick values…"
                          class="w-full"
                          @update:model-value="(v: string[]) => (f.value = v)"
                        />
                        <USelectMenu
                          v-else-if="['eq', 'neq'].includes(f.op)"
                          :model-value="f.value != null && f.value !== '' ? String(f.value) : undefined"
                          :items="fvItems(f.field)"
                          placeholder="Pick a value…"
                          class="w-full"
                          @update:model-value="(v: string) => (f.value = v)"
                        />
                        <UInput
                          v-else
                          :model-value="String(f.value ?? '')"
                          class="w-full text-xs"
                          placeholder="value"
                          @update:model-value="f.value = $event"
                        />
                      </template>
                      <!-- BOOL: always a static true/false select -->
                      <USelectMenu
                        v-else-if="fieldType(f.field) === 'bool'"
                        :model-value="f.value != null && f.value !== '' ? String(f.value) : undefined"
                        :items="['true', 'false']"
                        placeholder="Pick…"
                        class="w-full"
                        @update:model-value="(v: string) => (f.value = v)"
                      />
                      <!-- DATE: date picker for eq/neq/lt/gt, two dates for between -->
                      <template v-else-if="fieldType(f.field) === 'date'">
                        <div v-if="f.op === 'between'" class="flex gap-1">
                          <UInput
                            :model-value="valueAsArray(f.value)[0] ?? ''"
                            type="date"
                            class="w-full text-xs"
                            @update:model-value="(v) => (f.value = [v, valueAsArray(f.value)[1] ?? ''])"
                          />
                          <UInput
                            :model-value="valueAsArray(f.value)[1] ?? ''"
                            type="date"
                            class="w-full text-xs"
                            @update:model-value="(v) => (f.value = [valueAsArray(f.value)[0] ?? '', v])"
                          />
                        </div>
                        <UInput
                          v-else
                          :model-value="String(f.value ?? '')"
                          type="date"
                          class="w-full text-xs"
                          @update:model-value="f.value = $event"
                        />
                      </template>
                      <!-- NUMBER -->
                      <template v-else-if="fieldType(f.field) === 'number'">
                        <div v-if="f.op === 'between'" class="flex gap-1">
                          <UInput
                            :model-value="valueAsArray(f.value)[0] ?? ''"
                            type="number"
                            class="w-full text-xs"
                            placeholder="min"
                            @update:model-value="(v) => (f.value = [v, valueAsArray(f.value)[1] ?? ''])"
                          />
                          <UInput
                            :model-value="valueAsArray(f.value)[1] ?? ''"
                            type="number"
                            class="w-full text-xs"
                            placeholder="max"
                            @update:model-value="(v) => (f.value = [valueAsArray(f.value)[0] ?? '', v])"
                          />
                        </div>
                        <UInput
                          v-else
                          :model-value="f.value != null ? String(f.value) : ''"
                          type="number"
                          class="w-full text-xs"
                          @update:model-value="f.value = $event ? Number($event) : ''"
                        />
                      </template>
                      <!-- TEXT / UUID fallback -->
                      <UInput
                        v-else
                        :model-value="Array.isArray(f.value) ? f.value.join(',') : String(f.value ?? '')"
                        class="w-full text-xs"
                        placeholder="value"
                        @update:model-value="f.value = $event"
                      />
                    </UFormField>
                    <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeFilter(widget, fi)" />
                  </div>
                </div>

                <!-- Display -->
                <div class="space-y-3 pt-4 border-t border-default/60">
                  <p class="text-[11px] font-semibold text-muted uppercase tracking-wider">Display</p>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <UFormField label="Target" help="Numeric goal shown as progress.">
                      <UInput v-model.number="widget.target" type="number" class="w-full" placeholder="e.g. 30" />
                    </UFormField>
                    <UFormField label="Drill-down URL">
                      <UInput v-model="widget.drill_down" class="w-full font-mono text-xs" placeholder="/cases?filter=…" />
                    </UFormField>
                    <UFormField label="Caption" class="sm:col-span-2">
                      <UInput v-model="widget.caption" class="w-full" placeholder="Source note shown below widget" />
                    </UFormField>
                  </div>
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-muted">Thresholds</span>
                      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addThreshold(widget)">Add</UButton>
                    </div>
                    <div v-for="(t, ti) in widget.thresholds" :key="ti" class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50">
                      <UFormField label="At value"><UInput v-model.number="t.value" type="number" class="w-full" /></UFormField>
                      <UFormField label="Color"><USelectMenu v-model="t.color" :items="THRESHOLD_COLORS" value-key="value" label-key="label" class="w-full" /></UFormField>
                      <UFormField label="Label"><UInput v-model="t.label" class="w-full" placeholder="e.g. At risk" /></UFormField>
                      <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeThreshold(widget, ti)" />
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </template>
      </template>
    </template>

  </div>
</template>
