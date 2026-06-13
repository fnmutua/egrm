<script setup lang="ts">
/**
 * CD-15 Dashboards: tenant dashboard builder — dashboards → sections → widgets.
 * Structure: dashboard (settings, audience, filter bar) → section (title, order) → widget (chart kind, dataset, measures, filters…)
 */

// ---- Types ----

interface FilterDef {
  field: string;
  op: string;
  value: unknown;
}

interface Threshold {
  value: number;
  color: 'success' | 'warning' | 'error';
  label?: string;
}

interface Metric {
  measure: string;
  aggregation: string;
  label: string;
}

interface Widget {
  id: string;
  title: string;
  chart_kind: string;
  dataset: string;
  measure: string;
  aggregation: string;
  metrics: Metric[];
  group_by: string[];
  time_dimension?: string;
  bucket?: string;
  filters: FilterDef[];
  target?: number | null;
  thresholds: Threshold[];
  drill_down?: string | null;
  caption?: string | null;
}

interface Section {
  id: string;
  title: string;
  icon?: string;
  color?: string;
  order: number;
  widgets: Widget[];
}

interface Dashboard {
  id: string;
  title: string;
  icon?: string;
  audience: { roles: string[]; levels: string[] };
  is_main: boolean;
  is_public: boolean;
  layout: string;
  filter_bar: { period: boolean; unit: boolean; category: boolean };
  sections: Section[];
}

// ---- Constants ----

const DATASETS = [
  { value: 'cases', label: 'Cases', description: 'Case records with status, category, channel, unit, priority' },
  { value: 'case_events', label: 'Case events', description: 'Timeline events: created, transitioned, assigned, resolved' },
  { value: 'sla_clocks', label: 'SLA clocks', description: 'Acknowledgement, response, resolution targets and actuals' },
  { value: 'satisfaction', label: 'Satisfaction', description: 'Complainant satisfaction responses' },
  { value: 'cases_sensitive_aggregate', label: 'Sensitive aggregate', description: 'Pre-aggregated sensitive case data (minimum cell size enforced)' },
];

const CHART_KINDS = [
  { value: 'kpi_card', label: 'KPI Card', icon: 'i-lucide-square-dashed' },
  { value: 'bar', label: 'Bar', icon: 'i-lucide-bar-chart-2' },
  { value: 'stacked_bar', label: 'Stacked bar', icon: 'i-lucide-bar-chart' },
  { value: 'stacked_bar_100', label: 'Stacked bar 100%', icon: 'i-lucide-bar-chart' },
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
  { value: 'count', label: 'Count' },
  { value: 'count_distinct', label: 'Count distinct' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'pct', label: 'Percentage' },
];

const DIMENSIONS = [
  { value: 'category', label: 'Category' },
  { value: 'status_tag', label: 'Status tag' },
  { value: 'channel', label: 'Channel' },
  { value: 'priority', label: 'Priority' },
  { value: 'sensitivity', label: 'Sensitivity class' },
  { value: 'unit_level_1', label: 'Unit — level 1' },
  { value: 'unit_level_2', label: 'Unit — level 2' },
  { value: 'unit_level_3', label: 'Unit — level 3' },
  { value: 'time_bucket', label: 'Time bucket' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'team', label: 'Team' },
];

const TIME_DIMENSIONS = [
  { value: 'submitted_at', label: 'Submitted at' },
  { value: 'resolved_at', label: 'Resolved at' },
  { value: 'closed_at', label: 'Closed at' },
  { value: 'acknowledged_at', label: 'Acknowledged at' },
  { value: 'first_response_at', label: 'First response at' },
];

const TIME_BUCKETS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

const FILTER_OPS = [
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '≠ not equals' },
  { value: 'in', label: 'in list' },
  { value: 'nin', label: 'not in list' },
  { value: 'lt', label: '< less than' },
  { value: 'gt', label: '> greater than' },
  { value: 'between', label: 'between' },
];

const LAYOUT_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'single_col', label: 'Single column' },
];

const THRESHOLD_COLORS = [
  { value: 'success', label: 'Green (success)' },
  { value: 'warning', label: 'Amber (warning)' },
  { value: 'error', label: 'Red (error)' },
];

const DEFAULT_DASHBOARD_PACK: Omit<Dashboard, 'id'>[] = [
  {
    title: 'Operational',
    icon: 'i-lucide-clipboard-list',
    audience: { roles: [], levels: [] },
    is_main: true,
    is_public: false,
    layout: 'grid',
    filter_bar: { period: true, unit: true, category: false },
    sections: [],
  },
  {
    title: 'Management',
    icon: 'i-lucide-bar-chart-2',
    audience: { roles: [], levels: [] },
    is_main: false,
    is_public: false,
    layout: 'grid',
    filter_bar: { period: true, unit: true, category: true },
    sections: [],
  },
  {
    title: 'Public Transparency',
    icon: 'i-lucide-globe',
    audience: { roles: [], levels: [] },
    is_main: false,
    is_public: true,
    layout: 'grid',
    filter_bar: { period: true, unit: false, category: false },
    sections: [],
  },
];

// ---- Props & state ----

const props = defineProps<{ payload: Record<string, any> }>();
const { roleNames, loadRoleNames } = useTenantRoles();

onMounted(async () => {
  await loadRoleNames();
  ensure();
});

function ensure() {
  props.payload.dashboards ??= [];
  for (const d of props.payload.dashboards as Dashboard[]) {
    d.audience ??= { roles: [], levels: [] };
    d.audience.roles ??= [];
    d.audience.levels ??= [];
    d.is_main ??= false;
    d.is_public ??= false;
    d.layout ??= 'grid';
    d.filter_bar ??= { period: true, unit: true, category: false };
    d.sections ??= [];
    for (const s of d.sections) {
      s.widgets ??= [];
      for (const w of s.widgets) {
        w.metrics ??= [];
        w.group_by ??= [];
        w.filters ??= [];
        w.thresholds ??= [];
      }
    }
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const dashboards = computed<Dashboard[]>(() => props.payload.dashboards);

const expandedDash = ref<string | null>(null);
const expandedSection = ref<string | null>(null);
const expandedWidget = ref<string | null>(null);

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ---- Dashboard CRUD ----

function addDashboard() {
  const id = `dash-${uid()}`;
  props.payload.dashboards.push({
    id,
    title: 'New dashboard',
    icon: 'i-lucide-layout-dashboard',
    audience: { roles: [], levels: [] },
    is_main: false,
    is_public: false,
    layout: 'grid',
    filter_bar: { period: true, unit: true, category: false },
    sections: [],
  });
  expandedDash.value = id;
  expandedSection.value = null;
  expandedWidget.value = null;
}

function loadDefaultPack() {
  for (const tpl of DEFAULT_DASHBOARD_PACK) {
    props.payload.dashboards.push({ id: `dash-${uid()}`, ...structuredClone(tpl) });
  }
  expandedDash.value = null;
}

function removeDashboard(dash: Dashboard) {
  props.payload.dashboards = dashboards.value.filter((d) => d.id !== dash.id);
  if (expandedDash.value === dash.id) expandedDash.value = null;
}

function toggleDash(id: string) {
  expandedDash.value = expandedDash.value === id ? null : id;
  expandedSection.value = null;
  expandedWidget.value = null;
}

// ---- Section CRUD ----

function addSection(dash: Dashboard) {
  const id = `sec-${uid()}`;
  dash.sections.push({ id, title: 'New section', icon: '', color: '', order: dash.sections.length, widgets: [] });
  expandedSection.value = id;
  expandedWidget.value = null;
}

function removeSection(dash: Dashboard, section: Section) {
  dash.sections = dash.sections.filter((s) => s.id !== section.id);
  if (expandedSection.value === section.id) expandedSection.value = null;
}

function toggleSection(id: string) {
  expandedSection.value = expandedSection.value === id ? null : id;
  expandedWidget.value = null;
}

// ---- Widget CRUD ----

function addWidget(section: Section) {
  const id = `w-${uid()}`;
  section.widgets.push({
    id,
    title: 'New widget',
    chart_kind: 'kpi_card',
    dataset: 'cases',
    measure: 'id',
    aggregation: 'count',
    metrics: [],
    group_by: [],
    filters: [],
    thresholds: [],
  });
  expandedWidget.value = id;
}

function removeWidget(section: Section, widget: Widget) {
  section.widgets = section.widgets.filter((w) => w.id !== widget.id);
  if (expandedWidget.value === widget.id) expandedWidget.value = null;
}

function toggleWidget(id: string) {
  expandedWidget.value = expandedWidget.value === id ? null : id;
}

// ---- Metrics / filters / thresholds ----

function addMetric(widget: Widget) {
  widget.metrics.push({ measure: 'id', aggregation: 'count', label: '' });
}
function removeMetric(widget: Widget, i: number) { widget.metrics.splice(i, 1); }

function addFilter(widget: Widget) {
  widget.filters.push({ field: 'category', op: 'eq', value: '' });
}
function removeFilter(widget: Widget, i: number) { widget.filters.splice(i, 1); }

function addThreshold(widget: Widget) {
  widget.thresholds.push({ value: 0, color: 'warning', label: '' });
}
function removeThreshold(widget: Widget, i: number) { widget.thresholds.splice(i, 1); }

// ---- Helpers ----

const isMultiSeries = (kind: string) => ['multi_line', 'stacked_bar', 'stacked_bar_100', 'area'].includes(kind);
const needsTimeDim = (kind: string) => ['line', 'multi_line', 'area'].includes(kind);
const chartIcon = (kind: string) => CHART_KINDS.find((k) => k.value === kind)?.icon ?? 'i-lucide-bar-chart-2';
const datasetLabel = (val: string) => DATASETS.find((d) => d.value === val)?.label ?? val;
</script>

<template>
  <div class="space-y-3">

    <!-- Empty state -->
    <div v-if="dashboards.length === 0" class="text-center py-12 space-y-3">
      <UIcon name="i-lucide-layout-dashboard" class="size-10 text-muted mx-auto" />
      <p class="text-sm text-muted">No dashboards configured yet.</p>
      <div class="flex justify-center gap-2">
        <UButton variant="soft" icon="i-lucide-plus" @click="addDashboard">Add dashboard</UButton>
        <UButton variant="outline" icon="i-lucide-package" @click="loadDefaultPack">Load default pack</UButton>
      </div>
    </div>

    <!-- Dashboard list -->
    <div
      v-for="dash in dashboards"
      :key="dash.id"
      class="rounded-lg border border-default bg-default"
    >
      <!-- Dashboard header row -->
      <div
        class="flex items-center gap-2 px-4 py-3 cursor-pointer select-none hover:bg-elevated/40 transition rounded-lg"
        @click="toggleDash(dash.id)"
      >
        <UIcon :name="dash.icon || 'i-lucide-layout-dashboard'" class="text-primary shrink-0 size-5" />
        <span class="font-medium flex-1 truncate">{{ dash.title || '(untitled dashboard)' }}</span>
        <UBadge v-if="dash.is_main" size="xs" color="primary" variant="subtle">Main</UBadge>
        <UBadge v-if="dash.is_public" size="xs" color="success" variant="subtle">Public</UBadge>
        <UBadge size="xs" color="neutral" variant="subtle">{{ dash.sections.length }} section{{ dash.sections.length !== 1 ? 's' : '' }}</UBadge>
        <UBadge size="xs" color="neutral" variant="subtle">{{ dash.sections.reduce((n, s) => n + s.widgets.length, 0) }} widget{{ dash.sections.reduce((n, s) => n + s.widgets.length, 0) !== 1 ? 's' : '' }}</UBadge>
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeDashboard(dash)" />
        <UIcon :name="expandedDash === dash.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted size-4 shrink-0" />
      </div>

      <!-- Dashboard detail -->
      <template v-if="expandedDash === dash.id">

        <!-- Settings panel -->
        <div class="border-t border-default px-4 py-4 space-y-4 bg-muted/20">
          <p class="text-xs font-semibold text-muted uppercase tracking-wide">Dashboard settings</p>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <UFormField label="Title">
              <UInput v-model="dash.title" class="w-full" />
            </UFormField>
            <UFormField label="Icon" help="Lucide icon token, e.g. i-lucide-bar-chart-2">
              <UInput v-model="dash.icon" class="w-full font-mono text-xs" placeholder="i-lucide-layout-dashboard" />
            </UFormField>
            <UFormField label="Layout">
              <USelectMenu v-model="dash.layout" :items="LAYOUT_OPTIONS" value-key="value" label-key="label" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap gap-5">
            <label class="flex items-center gap-2 text-sm">
              <USwitch v-model="dash.is_main" size="sm" />
              Main dashboard (post-login landing)
            </label>
            <label class="flex items-center gap-2 text-sm">
              <USwitch v-model="dash.is_public" size="sm" />
              Public transparency page
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Audience — roles" help="Which roles see this dashboard. Empty = all roles.">
              <USelectMenu
                v-model="dash.audience.roles"
                :items="roleNames"
                multiple
                placeholder="All roles"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Global filter bar" help="Which filter controls viewers can adjust.">
              <div class="flex flex-wrap gap-4 mt-1">
                <label class="flex items-center gap-1.5 text-sm">
                  <UCheckbox v-model="dash.filter_bar.period" /> Period
                </label>
                <label class="flex items-center gap-1.5 text-sm">
                  <UCheckbox v-model="dash.filter_bar.unit" /> Unit
                </label>
                <label class="flex items-center gap-1.5 text-sm">
                  <UCheckbox v-model="dash.filter_bar.category" /> Category
                </label>
              </div>
            </UFormField>
          </div>
        </div>

        <!-- Sections -->
        <div class="px-4 py-3 space-y-2 border-t border-default">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs font-semibold text-muted uppercase tracking-wide">Sections</p>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addSection(dash)">Add section</UButton>
          </div>

          <p v-if="dash.sections.length === 0" class="text-xs text-muted italic py-2">No sections yet — add one above.</p>

          <div
            v-for="section in dash.sections"
            :key="section.id"
            class="rounded-lg border border-default"
          >
            <!-- Section header -->
            <div
              class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-elevated/30 transition rounded-lg"
              @click="toggleSection(section.id)"
            >
              <UIcon :name="section.icon || 'i-lucide-rows-3'" class="text-muted shrink-0 size-4" />
              <span class="text-sm font-medium flex-1 truncate">{{ section.title || '(untitled section)' }}</span>
              <UBadge size="xs" color="neutral" variant="subtle">{{ section.widgets.length }} widget{{ section.widgets.length !== 1 ? 's' : '' }}</UBadge>
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeSection(dash, section)" />
              <UIcon :name="expandedSection === section.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted size-4 shrink-0" />
            </div>

            <!-- Section detail -->
            <template v-if="expandedSection === section.id">
              <!-- Section settings -->
              <div class="border-t border-default px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-muted/10">
                <UFormField label="Title">
                  <UInput v-model="section.title" class="w-full" />
                </UFormField>
                <UFormField label="Icon">
                  <UInput v-model="section.icon" class="w-full font-mono text-xs" placeholder="i-lucide-rows-3" />
                </UFormField>
                <UFormField label="Accent color">
                  <UInput v-model="section.color" class="w-full" placeholder="primary / neutral / #hex" />
                </UFormField>
              </div>

              <!-- Widgets -->
              <div class="border-t border-default px-3 py-3 space-y-2">
                <div class="flex items-center justify-between mb-1">
                  <p class="text-xs font-semibold text-muted uppercase tracking-wide">Widgets</p>
                  <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addWidget(section)">Add widget</UButton>
                </div>

                <p v-if="section.widgets.length === 0" class="text-xs text-muted italic py-1">No widgets yet.</p>

                <div
                  v-for="widget in section.widgets"
                  :key="widget.id"
                  class="rounded border border-default/70"
                >
                  <!-- Widget header -->
                  <div
                    class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-elevated/20 transition rounded"
                    @click="toggleWidget(widget.id)"
                  >
                    <UIcon :name="chartIcon(widget.chart_kind)" class="text-primary shrink-0 size-4" />
                    <span class="text-sm flex-1 truncate">{{ widget.title || '(untitled widget)' }}</span>
                    <UBadge size="xs" color="neutral" variant="subtle" class="font-mono shrink-0">{{ widget.chart_kind }}</UBadge>
                    <UBadge size="xs" color="info" variant="subtle" class="shrink-0">{{ datasetLabel(widget.dataset) }}</UBadge>
                    <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeWidget(section, widget)" />
                    <UIcon :name="expandedWidget === widget.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted size-4 shrink-0" />
                  </div>

                  <!-- Widget editor -->
                  <div v-if="expandedWidget === widget.id" class="border-t border-default px-3 py-4 space-y-4 bg-muted/10">

                    <!-- Identity -->
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <UFormField label="Title" class="sm:col-span-1">
                        <UInput v-model="widget.title" class="w-full" />
                      </UFormField>
                      <UFormField label="Chart kind">
                        <USelectMenu
                          v-model="widget.chart_kind"
                          :items="CHART_KINDS"
                          value-key="value"
                          label-key="label"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField label="Dataset">
                        <USelectMenu
                          v-model="widget.dataset"
                          :items="DATASETS"
                          value-key="value"
                          label-key="label"
                          class="w-full"
                        />
                      </UFormField>
                    </div>

                    <!-- Measure (single) -->
                    <template v-if="!isMultiSeries(widget.chart_kind)">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <UFormField label="Measure" help="Field to aggregate, e.g. id, resolution_hours, rating">
                          <UInput v-model="widget.measure" class="w-full font-mono" placeholder="id" />
                        </UFormField>
                        <UFormField label="Aggregation">
                          <USelectMenu
                            v-model="widget.aggregation"
                            :items="AGGREGATIONS"
                            value-key="value"
                            label-key="label"
                            class="w-full"
                          />
                        </UFormField>
                      </div>
                    </template>

                    <!-- Metrics (multi-series) -->
                    <template v-else>
                      <div class="space-y-2">
                        <div class="flex items-center justify-between">
                          <p class="text-xs font-medium text-muted uppercase tracking-wide">Series</p>
                          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addMetric(widget)">Add series</UButton>
                        </div>
                        <p v-if="widget.metrics.length === 0" class="text-xs text-muted italic">No series — add one above.</p>
                        <div
                          v-for="(m, mi) in widget.metrics"
                          :key="mi"
                          class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50"
                        >
                          <UFormField label="Measure">
                            <UInput v-model="m.measure" class="w-full font-mono text-xs" placeholder="id" />
                          </UFormField>
                          <UFormField label="Aggregation">
                            <USelectMenu v-model="m.aggregation" :items="AGGREGATIONS" value-key="value" label-key="label" class="w-full" />
                          </UFormField>
                          <UFormField label="Series label">
                            <UInput v-model="m.label" class="w-full" placeholder="e.g. Resolved" />
                          </UFormField>
                          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeMetric(widget, mi)" />
                        </div>
                      </div>
                    </template>

                    <!-- Group by -->
                    <UFormField label="Group by" help="Dimensions to split results by (e.g. category, channel).">
                      <USelectMenu
                        v-model="widget.group_by"
                        :items="DIMENSIONS"
                        value-key="value"
                        label-key="label"
                        multiple
                        placeholder="No grouping (aggregate all)"
                        class="w-full"
                      />
                    </UFormField>

                    <!-- Time dimension (trend charts) -->
                    <template v-if="needsTimeDim(widget.chart_kind)">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <UFormField label="Time dimension" help="Date field to plot over time.">
                          <USelectMenu
                            v-model="widget.time_dimension"
                            :items="TIME_DIMENSIONS"
                            value-key="value"
                            label-key="label"
                            class="w-full"
                          />
                        </UFormField>
                        <UFormField label="Bucket">
                          <USelectMenu
                            v-model="widget.bucket"
                            :items="TIME_BUCKETS"
                            value-key="value"
                            label-key="label"
                            class="w-full"
                          />
                        </UFormField>
                      </div>
                    </template>

                    <!-- Filters -->
                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <p class="text-xs font-medium text-muted uppercase tracking-wide">Filters</p>
                        <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addFilter(widget)">Add filter</UButton>
                      </div>
                      <div
                        v-for="(f, fi) in widget.filters"
                        :key="fi"
                        class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50"
                      >
                        <UFormField label="Field">
                          <UInput v-model="f.field" class="w-full font-mono text-xs" placeholder="category" />
                        </UFormField>
                        <UFormField label="Operator">
                          <USelectMenu v-model="f.op" :items="FILTER_OPS" value-key="value" label-key="label" class="w-full" />
                        </UFormField>
                        <UFormField label="Value">
                          <UInput
                            :model-value="String(f.value ?? '')"
                            class="w-full text-xs"
                            placeholder="value or comma-list"
                            @update:model-value="f.value = $event"
                          />
                        </UFormField>
                        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeFilter(widget, fi)" />
                      </div>
                    </div>

                    <!-- Target & thresholds -->
                    <div class="space-y-3">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <UFormField label="Target value" help="Optional numeric target shown as a progress indicator.">
                          <UInput v-model.number="widget.target" type="number" class="w-full" placeholder="e.g. 30" />
                        </UFormField>
                      </div>
                      <div class="space-y-2">
                        <div class="flex items-center justify-between">
                          <p class="text-xs font-medium text-muted uppercase tracking-wide">Thresholds</p>
                          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addThreshold(widget)">Add threshold</UButton>
                        </div>
                        <div
                          v-for="(t, ti) in widget.thresholds"
                          :key="ti"
                          class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 rounded border border-default/50"
                        >
                          <UFormField label="At value">
                            <UInput v-model.number="t.value" type="number" class="w-full" />
                          </UFormField>
                          <UFormField label="Color">
                            <USelectMenu v-model="t.color" :items="THRESHOLD_COLORS" value-key="value" label-key="label" class="w-full" />
                          </UFormField>
                          <UFormField label="Label">
                            <UInput v-model="t.label" class="w-full" placeholder="e.g. At risk" />
                          </UFormField>
                          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="mb-0.5" @click="removeThreshold(widget, ti)" />
                        </div>
                      </div>
                    </div>

                    <!-- Drill-down & caption -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <UFormField label="Drill-down URL" help="Optional link to a queue view or child dashboard when a user clicks the widget.">
                        <UInput v-model="widget.drill_down" class="w-full font-mono text-xs" placeholder="/cases?filter=…" />
                      </UFormField>
                      <UFormField label="Caption / source note" help="Small footer text shown below the widget.">
                        <UInput v-model="widget.caption" class="w-full" placeholder="Source: GRM database" />
                      </UFormField>
                    </div>

                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>

    <!-- Bottom actions (when dashboards exist) -->
    <div v-if="dashboards.length > 0" class="flex gap-2 pt-1">
      <UButton variant="soft" icon="i-lucide-plus" @click="addDashboard">Add dashboard</UButton>
      <UButton variant="outline" icon="i-lucide-package" @click="loadDefaultPack">Add default pack</UButton>
    </div>

  </div>
</template>
