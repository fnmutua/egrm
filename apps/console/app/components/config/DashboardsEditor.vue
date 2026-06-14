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
  thresholds: Threshold[];
  size?: 'compact' | 'standard' | 'wide' | 'full';
  unit_level?: string;
  icon?: string;
  sparkline_period?: '7d' | '14d' | '30d' | '8w' | '6m' | null;
  gauge_variant?: 'basic' | 'custom_label' | 'needle' | 'semi';
  gauge_label?: string | null;
}

interface Section {
  id: string; title: string; icon?: string; color?: string; order: number; widgets: Widget[];
}

interface Dashboard {
  id: string; title: string; icon?: string;
  audience: { roles: string[]; levels: string[] };
  is_main: boolean; is_public: boolean; layout: string;
  filter_bar: { period: boolean; unit: boolean; category: boolean; unit_level?: string };
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
  { value: 'kpi_spark', label: 'KPI Spark', icon: 'i-lucide-chart-line' },
  { value: 'bar', label: 'Bar', icon: 'i-lucide-bar-chart-2' },
  { value: 'stacked_bar', label: 'Stacked bar', icon: 'i-lucide-bar-chart' },
  { value: 'stacked_bar_100', label: 'Stacked 100%', icon: 'i-lucide-bar-chart' },
  { value: 'line', label: 'Line', icon: 'i-lucide-trending-up' },
  { value: 'multi_line', label: 'Multi-line', icon: 'i-lucide-activity' },
  { value: 'area', label: 'Area', icon: 'i-lucide-area-chart' },
  { value: 'pie', label: 'Pie', icon: 'i-lucide-pie-chart' },
  { value: 'donut', label: 'Donut', icon: 'i-lucide-circle-dashed' },
  { value: 'gauge', label: 'Gauge', icon: 'i-lucide-gauge' },
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
const MEASURES = [
  { value: 'id',          label: 'Cases (id)' },
  { value: 'assignee_id', label: 'Assignee' },
  { value: 'party_id',    label: 'Complainant' },
  { value: 'unit_id',     label: 'Unit' },
];
const FALLBACK_CASE_FIELDS = [
  { value: 'status', label: 'Status', group: 'case' },
  { value: 'status_tag', label: 'Status tag', group: 'case' },
  { value: 'channel', label: 'Channel', group: 'case' },
  { value: 'priority', label: 'Priority', group: 'case' },
  { value: 'sensitivity', label: 'Sensitivity', group: 'case' },
  { value: 'case_type', label: 'Case type', group: 'case' },
  { value: 'level_code', label: 'Case level', group: 'case' },
  { value: 'anonymous', label: 'Anonymous', group: 'case' },
  { value: 'unit_id', label: 'Unit', group: 'case' },
  { value: 'assignee_id', label: 'Assignee', group: 'case' },
  { value: 'party_id', label: 'Complainant', group: 'case' },
];
const FALLBACK_UNIT_ROLLUPS: { value: string; label: string; group: string }[] = [];
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
  { value: 'level_code',  label: 'Case level' },
  { value: 'anonymous',   label: 'Anonymous' },
  { value: 'unit_id',     label: 'Unit (subtree)' },
];
const FIELD_TYPE: Record<string, 'enum' | 'bool' | 'text' | 'number' | 'date' | 'unit'> = {
  status:      'enum',
  status_tag:  'enum',
  channel:     'enum',
  priority:    'enum',
  sensitivity: 'enum',
  category:    'enum',
  level_code:  'enum',
  anonymous:   'bool',
  unit_id:     'unit',
};
const LAYOUT_OPTIONS = [{ value: 'grid', label: 'Grid' }, { value: 'single_col', label: 'Single column' }];
const WIDGET_SIZES = [
  { value: 'compact', label: 'Compact', help: 'Fits small grid cells — shorter chart, tighter labels.' },
  { value: 'standard', label: 'Standard', help: 'Default single-column tile.' },
  { value: 'wide', label: 'Wide (2 cols)', help: 'Best for line, stacked, and multi-series charts.' },
  { value: 'full', label: 'Full width', help: 'Spans the entire row — use for busy charts.' },
];
const THRESHOLD_COLORS = [{ value: 'success', label: 'Green' }, { value: 'warning', label: 'Amber' }, { value: 'error', label: 'Red' }];
const SPARKLINE_PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '8w', label: 'Last 8 weeks' },
  { value: '6m', label: 'Last 6 months' },
];
const GAUGE_VARIANTS = [
  { value: 'basic', label: 'Basic' },
  { value: 'custom_label', label: 'Custom label' },
  { value: 'needle', label: 'Needle' },
  { value: 'semi', label: 'Semi-circle' },
] as const;
const CATEGORY_MODES = [
  { value: 'field', label: 'Case field' },
  { value: 'unit_level', label: 'Admin unit level' },
];

// ---- Props & state ----

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { roleNames, loadRoleNames } = useTenantRoles();
const { api } = useApi();

// Field value cache for filter autocomplete
const fieldValuesCache = reactive<Record<string, string[]>>({});
const fieldValueLabels = reactive<Record<string, Record<string, string>>>({});
const fieldValuesLoading = reactive<Record<string, boolean>>({});
const caseFieldOptions = ref(FALLBACK_CASE_FIELDS);
const unitRollupOptions = ref(FALLBACK_UNIT_ROLLUPS);
const groupByOptions = computed(() => [...caseFieldOptions.value, ...unitRollupOptions.value]);
const hierarchyLevelItems = computed(() =>
  unitRollupOptions.value.map((o) => ({
    value: o.value.replace(/^unit_level:/, ''),
    label: o.label,
  })),
);
const topHierarchyLevel = computed(() => hierarchyLevelItems.value[0]?.value);
/** Filter bar starts one level below the hierarchy top (e.g. County, not National). */
const filterStartLevelItems = computed(() => hierarchyLevelItems.value.slice(1));
const defaultFilterUnitLevel = computed(
  () => filterStartLevelItems.value[0]?.value ?? hierarchyLevelItems.value[0]?.value,
);

function applyDefaultUnitLevels() {
  const start = defaultFilterUnitLevel.value;
  if (!start) return;
  for (const d of props.payload.dashboards as Dashboard[]) {
    d.filter_bar ??= { period: true, unit: true, category: false };
    if (d.filter_bar.unit && !d.filter_bar.unit_level) d.filter_bar.unit_level = start;
  }
}

function onUnitFilterToggle(dash: Dashboard, enabled: boolean) {
  dash.filter_bar.unit = enabled;
  if (enabled && !dash.filter_bar.unit_level && defaultFilterUnitLevel.value) {
    dash.filter_bar.unit_level = defaultFilterUnitLevel.value;
  }
}

async function ensureFieldValues(field: string) {
  if (fieldValuesCache[field] !== undefined || fieldValuesLoading[field]) return;
  fieldValuesLoading[field] = true;
  try {
    const res = await api<{ values: string[]; labels?: Record<string, string> }>(
      `/api/v1/dashboards/field-values?field=${encodeURIComponent(field)}&dataset=cases`,
    );
    fieldValuesCache[field] = res.values;
    if (res.labels) fieldValueLabels[field] = res.labels;
  } catch {
    fieldValuesCache[field] = [];
  } finally {
    fieldValuesLoading[field] = false;
  }
}

function fvItems(field: string): string[] { return fieldValuesCache[field] ?? []; }
function fvUnitItems(field: string) {
  return (fieldValuesCache[field] ?? []).map((id) => ({
    value: id,
    label: fieldValueLabels[field]?.[id] ?? id,
  }));
}
function fieldType(field: string) { return FIELD_TYPE[field] ?? 'text'; }
function valueAsArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

onMounted(async () => {
  await loadRoleNames();
  ensure();
  try {
    const res = await api<{
      case_fields?: { value: string; label: string; group: string }[];
      case_dimensions?: { value: string; label: string; group: string }[];
      unit_rollups?: { value: string; label: string; group: string }[];
      unit_dimensions?: { value: string; label: string; group: string }[];
    }>('/api/v1/dashboards/dimensions');
    caseFieldOptions.value = res.case_fields ?? res.case_dimensions ?? FALLBACK_CASE_FIELDS;
    unitRollupOptions.value = res.unit_rollups ?? res.unit_dimensions ?? FALLBACK_UNIT_ROLLUPS;
    applyDefaultUnitLevels();
  } catch {
    caseFieldOptions.value = FALLBACK_CASE_FIELDS;
    unitRollupOptions.value = FALLBACK_UNIT_ROLLUPS;
  }
  ensureFieldValues('unit_id');
});

function ensure() {
  props.payload.dashboards ??= [];
  for (const d of props.payload.dashboards as Dashboard[]) {
    d.audience ??= { roles: [], levels: [] };
    d.audience.roles ??= []; d.audience.levels ??= [];
    d.is_main ??= false; d.is_public ??= false; d.layout ??= 'grid';
    d.filter_bar ??= { period: true, unit: true, category: false };
    if (d.filter_bar.unit && !d.filter_bar.unit_level && defaultFilterUnitLevel.value) {
      d.filter_bar.unit_level = defaultFilterUnitLevel.value;
    }
    d.sections ??= [];
    for (const s of d.sections) {
      s.widgets ??= [];
      for (const w of s.widgets) {
        w.metrics ??= []; w.group_by ??= []; w.filters ??= []; w.thresholds ??= [];
        w.size ??= 'standard';
        normalizeWidgetForChart(w, w.chart_kind);
      }
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
    if (f.field && (fieldType(f.field) === 'enum' || fieldType(f.field) === 'unit')) ensureFieldValues(f.field);
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

function moveWidgetUp(sec: Section, i: number) {
  if (i === 0) return;
  [sec.widgets[i - 1], sec.widgets[i]] = [sec.widgets[i]!, sec.widgets[i - 1]!];
}

function moveWidgetDown(sec: Section, i: number) {
  if (i >= sec.widgets.length - 1) return;
  [sec.widgets[i], sec.widgets[i + 1]] = [sec.widgets[i + 1]!, sec.widgets[i]!];
}

function cloneWidget(sec: Section, w: Widget) {
  const idx = sec.widgets.findIndex((x) => x.id === w.id);
  const id = `w-${uid()}`;
  const copy = structuredClone(w);
  copy.id = id;
  copy.title = w.title ? `${w.title} (copy)` : 'New widget (copy)';
  sec.widgets.splice(idx + 1, 0, copy);
  expandedWidgetId.value = id;
}

function toggleWidget(id: string) { expandedWidgetId.value = expandedWidgetId.value === id ? null : id; }

function addFilter(w: Widget) { w.filters.push({ field: 'status', op: 'eq', value: '' }); ensureFieldValues('status'); }
function removeFilter(w: Widget, i: number) { w.filters.splice(i, 1); }
function addThreshold(w: Widget) { w.thresholds.push({ value: 0, color: 'warning', label: '' }); }
function removeThreshold(w: Widget, i: number) { w.thresholds.splice(i, 1); }

// ---- Chart-type profiles: which data fields each renderer needs ----

interface DimSlot {
  show: boolean;
  label: string;
  required: boolean;
  help: string;
}

interface ChartProfile {
  hint: string;
  measure: boolean;
  aggregation: boolean;
  categories: DimSlot;
  series: DimSlot;
  time: { show: boolean; required: boolean };
  filters: boolean;
  kpiDisplay: boolean;
  /** Show target + threshold fields (KPI card or gauge % of target). */
  targetDisplay?: boolean;
}

const CHART_PROFILES: Record<string, ChartProfile> = {
  kpi_card: {
    hint: 'Single total with optional target and colour thresholds.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: true,
  },
  kpi_spark: {
    hint: 'KPI total plus a mini trend sparkline over a chosen period.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: true,
  },
  bar: {
    hint: 'Bars compare one measure across a category dimension.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Categories', required: true, help: 'Labels on the axis — e.g. County, Status, Channel.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  pie: {
    hint: 'Each slice is a share of the total for one category dimension.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Slices', required: true, help: 'Dimension that defines each slice.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  donut: {
    hint: 'Same as pie — slices from one category dimension.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Slices', required: true, help: 'Dimension that defines each slice.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  gauge: {
    hint: 'Radial gauge — pick a style variant; % = actual ÷ target × 100.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false, targetDisplay: true,
  },
  table: {
    hint: 'Rows from one category dimension with a numeric value column.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Rows', required: true, help: 'Dimension listed in the first column.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  stacked_bar: {
    hint: 'Stacked bars from two fields — pick a unit level (County, Ward…) on the axis, not individual settlements.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Categories (axis)', required: true, help: 'Axis labels — case field or unit level (County, Ward, etc.).' },
    series: { show: true, label: 'Series (stacks)', required: true, help: 'Second field for stack segments — e.g. Status, Channel.' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  stacked_bar_100: {
    hint: '100% stacked bars from two fields.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Categories (axis)', required: true, help: 'Axis labels — case field or unit level.' },
    series: { show: true, label: 'Series (stacks)', required: true, help: 'Second field for stack segments.' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  line: {
    hint: 'Trend over time — one line, no series split.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: true, required: true },
    filters: true, kpiDisplay: false,
  },
  multi_line: {
    hint: 'Multiple lines over time — pick a series dimension to split lines.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: true, label: 'Series (lines)', required: true, help: 'Each value becomes a separate line — e.g. Status, Priority.' },
    time: { show: true, required: true },
    filters: true, kpiDisplay: false,
  },
  area: {
    hint: 'Stacked area over time — series dimension fills the chart.',
    measure: true, aggregation: true,
    categories: { show: false, label: '', required: false, help: '' },
    series: { show: true, label: 'Series (areas)', required: true, help: 'Each value becomes a stacked area band.' },
    time: { show: true, required: true },
    filters: true, kpiDisplay: false,
  },
  treemap: {
    hint: 'Treemap tiles sized by value — one category dimension.',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Tiles', required: true, help: 'Dimension that defines each tile.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  map: {
    hint: 'Map renderer — group by an admin-unit level (not yet live).',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Region', required: true, help: 'Admin-unit level for map regions — e.g. County, Ward.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
  pyramid: {
    hint: 'Pyramid renderer — one category dimension (not yet live).',
    measure: true, aggregation: true,
    categories: { show: true, label: 'Categories', required: true, help: 'Dimension for pyramid tiers.' },
    series: { show: false, label: '', required: false, help: '' },
    time: { show: false, required: false },
    filters: true, kpiDisplay: false,
  },
};

const DEFAULT_PROFILE: ChartProfile = CHART_PROFILES.bar!;

function chartProfile(kind: string): ChartProfile {
  return CHART_PROFILES[kind] ?? DEFAULT_PROFILE;
}

function defaultWidgetUnitLevel(): string | undefined {
  return activeDash.value?.filter_bar?.unit_level ?? defaultFilterUnitLevel.value;
}

function supportsGeoCategory(kind: string): boolean {
  return chartProfile(kind).categories.show && kind !== 'map' && !isStackedChart(kind);
}

function widgetCategoryMode(w: Widget): 'field' | 'unit_level' {
  if (w.chart_kind === 'map') return 'unit_level';
  const cat = categoryDim(w);
  if (cat === 'unit_id' || cat?.startsWith('unit_level:') || w.unit_level) return 'unit_level';
  return 'field';
}

function setWidgetCategoryMode(w: Widget, mode: 'field' | 'unit_level') {
  if (mode === 'unit_level') {
    const level = w.unit_level ?? defaultWidgetUnitLevel();
    if (!level) return;
    onWidgetUnitLevelChange(w, level);
  } else {
    w.unit_level = undefined;
    if (categoryDim(w)?.startsWith('unit_level:')) setCategoryDim(w, undefined);
  }
}

function onWidgetUnitLevelChange(w: Widget, level: string) {
  w.unit_level = level;
  setCategoryDim(w, `unit_level:${level}`);
}

function widgetUnitLevelHelp(w: Widget): string {
  const dashLevel = activeDash.value?.filter_bar?.unit_level;
  const dashLabel = hierarchyLevelItems.value.find((l) => l.value === dashLevel)?.label;
  if (dashLevel && w.unit_level === dashLevel) {
    return `Matches this dashboard's unit filter (${dashLabel ?? dashLevel}). Choose a lower level to drill down.`;
  }
  return 'Groups cases by admin units at the selected hierarchy level.';
}

function categoryDim(w: Widget): string | undefined { return w.group_by[0]; }
function seriesDim(w: Widget): string | undefined { return w.group_by[1]; }

function seriesValue(w: Widget): string | undefined {
  return chartProfile(w.chart_kind).categories.show ? seriesDim(w) : categoryDim(w);
}

function setSeriesValue(w: Widget, v: string | undefined) {
  setSeriesDim(w, v);
}

function setCategoryDim(w: Widget, v: string | undefined) {
  const series = w.group_by[1];
  w.group_by = v ? (series ? [v, series] : [v]) : (series ? [series] : []);
  if (v?.startsWith('unit_level:')) {
    w.unit_level = v.slice('unit_level:'.length);
  } else {
    w.unit_level = undefined;
  }
}

function setSeriesDim(w: Widget, v: string | undefined) {
  const cat = w.group_by[0];
  if (chartProfile(w.chart_kind).categories.show) {
    w.group_by = cat ? (v ? [cat, v] : [cat]) : (v ? [v] : []);
  } else {
    w.group_by = v ? [v] : [];
  }
}

function normalizeWidgetForChart(w: Widget, kind: string) {
  const p = chartProfile(kind);
  const stackedScalars = stackedCaseFieldOptions().map((o) => o.value);
  const unitRollupValues = unitRollupOptions.value.map((o) => o.value);
  const allowed = new Set(
    isStackedChart(kind)
      ? [...stackedScalars, ...unitRollupValues]
      : groupByOptions.value.map((o) => o.value),
  );
  w.group_by = w.group_by.filter((d) => allowed.has(d));
  if (!p.categories.show && !p.series.show) w.group_by = [];
  else if (p.categories.show && !p.series.show) w.group_by = w.group_by.slice(0, 1);
  else if (p.categories.show && p.series.show) w.group_by = w.group_by.slice(0, 2);
  else if (!p.categories.show && p.series.show) w.group_by = w.group_by[1] ? [w.group_by[1]!] : w.group_by.slice(0, 1);

  if (!p.time.show) {
    delete w.time_dimension;
    delete w.bucket;
  } else if (!w.time_dimension) {
    w.time_dimension = 'submitted_at';
    w.bucket = w.bucket ?? 'month';
  }

  if (!p.measure) {
    w.measure = 'id';
    w.aggregation = 'count';
  }

  w.metrics = [];

  if (kind === 'kpi_card' || kind === 'kpi_spark') {
    w.size = 'compact';
  }

  if (kind === 'gauge') {
    w.gauge_variant ??= 'basic';
    if (w.gauge_variant !== 'custom_label') delete w.gauge_label;
  }

  if (kind === 'map') {
    const level = w.unit_level ?? defaultWidgetUnitLevel();
    if (level) {
      w.unit_level = level;
      w.group_by = [`unit_level:${level}`];
    }
  } else if (isStackedChart(kind) && w.group_by[0] === 'unit_id') {
    const level = w.unit_level ?? defaultWidgetUnitLevel();
    if (level) onWidgetUnitLevelChange(w, level);
  } else if (w.unit_level && supportsGeoCategory(kind)) {
    const dim = `unit_level:${w.unit_level}`;
    const series = w.group_by[1];
    w.group_by = series && p.series.show ? [dim, series] : [dim];
  }
}

function onChartKindChange(w: Widget, kind: string) {
  w.chart_kind = kind;
  if (kind === 'kpi_spark' && !w.sparkline_period) w.sparkline_period = '7d';
  if (kind === 'kpi_card') delete w.sparkline_period;
  if (kind === 'gauge') {
    w.gauge_variant ??= 'basic';
    if (w.gauge_variant !== 'custom_label') delete w.gauge_label;
  } else {
    delete w.gauge_variant;
    delete w.gauge_label;
  }
  normalizeWidgetForChart(w, kind);
}

const SEED_KPI_CARD_VARIANTS = [
  { title: 'Total cases', icon: 'i-lucide-hash', filters: [] as FilterDef[] },
  { title: 'Open cases', icon: 'i-lucide-inbox', filters: [{ field: 'status', op: 'in', value: ['received', 'investigation'] }] },
];
const SEED_KPI_SPARK_VARIANTS = [
  { title: 'Closed', icon: 'i-lucide-check-circle-2', filters: [{ field: 'status', op: 'eq', value: 'closed' }], sparkline_period: '30d' as const },
  { title: 'High priority', icon: 'i-lucide-alert-triangle', filters: [{ field: 'priority', op: 'eq', value: 'high' }], sparkline_period: '8w' as const },
];
const SEED_SECTIONS = [
  { title: 'Cards', icon: 'i-lucide-square-dashed' },
  { title: 'Charts', icon: 'i-lucide-chart-area' },
] as const;

function seedChartIcon(kind: string): string {
  return CHART_KINDS.find((c) => c.value === kind)?.icon ?? 'i-lucide-bar-chart-2';
}

function buildSeedWidget(
  kind: string,
  label: string,
  filters: FilterDef[] = [],
  icon?: string,
  opts?: { sparkline_period?: Widget['sparkline_period']; target?: number; gauge_variant?: Widget['gauge_variant'] },
): Widget {
  const w: Widget = {
    id: `w-${uid()}`,
    title: label,
    chart_kind: kind,
    icon: icon ?? seedChartIcon(kind),
    dataset: 'cases',
    measure: 'id',
    aggregation: 'count',
    metrics: [],
    group_by: [],
    filters: [],
    thresholds: [],
    size: 'standard',
  };
  if (filters.length) w.filters = structuredClone(filters);
  const level = defaultWidgetUnitLevel();
  const unitDim = level ? `unit_level:${level}` : undefined;

  if (kind === 'kpi_card') {
    w.size = 'compact';
  } else if (kind === 'kpi_spark') {
    w.size = 'compact';
    w.sparkline_period = opts?.sparkline_period ?? '7d';
  } else if (kind === 'gauge') {
    w.target = opts?.target ?? 100;
    w.gauge_variant = opts?.gauge_variant ?? 'basic';
    w.size = 'standard';
  } else if (['bar', 'pie', 'donut', 'table', 'treemap', 'pyramid'].includes(kind)) {
    w.group_by = ['status'];
  } else if (kind === 'stacked_bar' || kind === 'stacked_bar_100') {
    w.size = 'wide';
    if (unitDim && level) {
      w.unit_level = level;
      w.group_by = [unitDim, 'status'];
    } else {
      w.group_by = ['channel', 'status'];
    }
  } else if (kind === 'line') {
    w.size = 'wide';
    w.time_dimension = 'submitted_at';
    w.bucket = 'month';
  } else if (kind === 'multi_line' || kind === 'area') {
    w.size = 'wide';
    w.group_by = ['status'];
    w.time_dimension = 'submitted_at';
    w.bucket = 'month';
  } else if (kind === 'map' && unitDim && level) {
    w.size = 'wide';
    w.unit_level = level;
    w.group_by = [unitDim];
  }

  normalizeWidgetForChart(w, kind);
  return w;
}

const seedOpen = ref(false);
const seedDashboardCount = ref(1);

function seedDashboards() {
  const dashCount = Math.max(1, Math.min(20, Math.round(seedDashboardCount.value) || 1));
  const canBeMain = !dashboards.value.some((d) => d.is_main);
  const filterLevel = defaultFilterUnitLevel.value;
  const chartKinds = CHART_KINDS.filter((ck) => !['kpi_card', 'kpi_spark'].includes(ck.value));
  let firstDashId: string | null = null;

  for (let d = 0; d < dashCount; d++) {
    const dashId = `dash-${uid()}`;
    if (!firstDashId) firstDashId = dashId;

    const sections: Section[] = SEED_SECTIONS.map((sec, order) => ({
      id: `sec-${uid()}`,
      title: sec.title,
      icon: sec.icon,
      color: '',
      order,
      widgets: [],
    }));

    for (const preset of SEED_KPI_CARD_VARIANTS) {
      sections[0]!.widgets.push(buildSeedWidget('kpi_card', preset.title, preset.filters, preset.icon));
    }
    for (const preset of SEED_KPI_SPARK_VARIANTS) {
      sections[0]!.widgets.push(
        buildSeedWidget('kpi_spark', preset.title, preset.filters, preset.icon, { sparkline_period: preset.sparkline_period }),
      );
    }

    chartKinds.forEach((ck) => {
      const extra = ck.value === 'gauge' ? { target: 100 } : undefined;
      sections[1]!.widgets.push(buildSeedWidget(ck.value, ck.label, [], ck.icon, extra));
    });

    props.payload.dashboards.push({
      id: dashId,
      title: dashCount === 1 ? 'Sample dashboard' : `Sample dashboard ${d + 1}`,
      icon: 'i-lucide-layout-dashboard',
      audience: { roles: [], levels: [] },
      is_main: canBeMain && d === 0,
      is_public: false,
      layout: 'grid',
      filter_bar: {
        period: true,
        unit: true,
        category: false,
        ...(filterLevel ? { unit_level: filterLevel } : {}),
      },
      sections,
    });
  }

  if (firstDashId) {
    activeDashId.value = firstDashId;
    const firstDash = dashboards.value.find((x) => x.id === firstDashId);
    activeSectionId.value = firstDash?.sections[0]?.id ?? null;
  }
  seedOpen.value = false;
}

function widgetConfigIssues(w: Widget): string[] {
  const p = chartProfile(w.chart_kind);
  const issues: string[] = [];
  if (p.categories.required) {
    if (widgetCategoryMode(w) === 'unit_level') {
      if (!(w.unit_level ?? defaultWidgetUnitLevel())) issues.push('Unit level is required');
    } else if (!categoryDim(w)) {
      issues.push(`${p.categories.label} is required`);
    }
  }
  if (p.series.required) {
    if (!seriesValue(w)) issues.push(`${p.series.label} is required`);
  }
  if (p.time.required && (!w.time_dimension || !w.bucket)) issues.push('Time dimension and bucket are required');
  if (w.chart_kind === 'gauge' && !(w.target != null && w.target > 0)) issues.push('Target is required');
  if (w.chart_kind === 'kpi_spark' && !w.sparkline_period) issues.push('Sparkline period is required');
  return issues;
}

const STACKED_CHARTS = new Set(['stacked_bar', 'stacked_bar_100']);

function isStackedChart(kind: string) {
  return STACKED_CHARTS.has(kind);
}

function stackedCaseFieldOptions() {
  return caseFieldOptions.value.filter((o) => o.value !== 'unit_id');
}

function stackedCategoryOptions() {
  return [...stackedCaseFieldOptions(), ...unitRollupOptions.value];
}

function categoryFieldOptions(w: Widget) {
  if (w.chart_kind === 'map') return unitRollupOptions.value;
  if (isStackedChart(w.chart_kind)) return stackedCategoryOptions();
  if (widgetCategoryMode(w) === 'unit_level') return unitRollupOptions.value;
  return caseFieldOptions.value;
}

function isTimeSplitChart(kind: string) {
  return kind === 'multi_line' || kind === 'area';
}

function seriesFieldOptions(w: Widget) {
  const items = isStackedChart(w.chart_kind)
    ? stackedCaseFieldOptions()
    : isTimeSplitChart(w.chart_kind)
      ? caseFieldOptions.value
      : groupByOptions.value;
  const cat = categoryDim(w);
  return cat ? items.filter((o) => o.value !== cat && !o.value.startsWith('unit_level:')) : items;
}

const mapGroupByOptions = computed(() => unitRollupOptions.value);

const isKpiCard = (k: string) => k === 'kpi_card' || k === 'kpi_spark';
const hasTargetConfig = (k: string) => chartProfile(k).targetDisplay ?? chartProfile(k).kpiDisplay;
const isChartWidget = (k: string) => !isKpiCard(k);
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
          <UButton size="xs" variant="outline" icon="i-lucide-wand-sparkles" @click="seedOpen = true">Seed dashboards</UButton>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addDashboard">Add</UButton>
        </div>
      </div>

      <UModal
        v-model:open="seedOpen"
        title="Seed dashboards"
        :description="`Two sections per dashboard: 2 KPI Cards + 2 KPI Spark, and one widget per chart type (${CHART_KINDS.length - 2} charts).`"
      >
        <template #body>
          <UFormField label="Dashboards" help="How many dashboards to add (1–20).">
            <UInput v-model.number="seedDashboardCount" type="number" min="1" max="20" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted mt-3">
            Each dashboard gets {{ SEED_SECTIONS.length }} sections: <span class="font-medium">Cards</span> (2 KPI Card + 2 KPI Spark) and
            <span class="font-medium">Charts</span> (bar, line, pie, table, etc.).
          </p>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton variant="ghost" color="neutral" @click="seedOpen = false">Cancel</UButton>
            <UButton icon="i-lucide-wand-sparkles" @click="seedDashboards">Seed</UButton>
          </div>
        </template>
      </UModal>

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
              <UFormField label="Icon">
                <IconPicker v-model="dash.icon" placeholder="i-lucide-layout-dashboard" />
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
                  <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                    <UCheckbox :model-value="dash.filter_bar.unit" @update:model-value="onUnitFilterToggle(dash, $event)" /> Unit
                  </label>
                  <label class="flex items-center gap-1.5 text-sm cursor-pointer"><UCheckbox v-model="dash.filter_bar.category" /> Category</label>
                </div>
              </UFormField>
              <UFormField
                v-if="dash.filter_bar.unit"
                label="Unit filter level"
                help="First level shown in the dashboard unit picker. The hierarchy top (e.g. National) is omitted — defaults to the level below (e.g. County)."
              >
                <USelectMenu
                  v-model="dash.filter_bar.unit_level"
                  :items="filterStartLevelItems"
                  value-key="value"
                  label-key="label"
                  placeholder="County (default)"
                  class="w-full"
                />
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
                <UFormField label="Icon">
                  <IconPicker v-model="sec.icon" placeholder="i-lucide-rows-3" />
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
            <div v-for="(widget, wi) in activeSection.widgets" :key="widget.id">

              <!-- Widget row -->
              <div
                class="flex items-center gap-3 px-0 py-2.5 cursor-pointer hover:bg-elevated/40 transition"
                @click="toggleWidget(widget.id)"
              >
                <UIcon :name="chartIcon(widget.chart_kind)" class="size-4 text-muted shrink-0" />
                <span class="text-sm font-medium flex-1 truncate">{{ widget.title || '(untitled)' }}</span>
                <span class="text-xs text-muted shrink-0">{{ widget.chart_kind }}</span>
                <span v-if="widget.size && widget.size !== 'standard'" class="text-xs text-muted shrink-0">{{ widget.size }}</span>
                <span class="text-xs text-muted shrink-0">{{ datasetLabel(widget.dataset) }}</span>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-up" :disabled="wi === 0" title="Move up" @click.stop="moveWidgetUp(activeSection, wi)" />
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :disabled="wi === activeSection.widgets.length - 1" title="Move down" @click.stop="moveWidgetDown(activeSection, wi)" />
                <UButton size="xs" variant="ghost" icon="i-lucide-copy" title="Clone widget" @click.stop="cloneWidget(activeSection, widget)" />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeWidget(activeSection, widget)" />
                <UIcon :name="expandedWidgetId === widget.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted shrink-0" />
              </div>

              <!-- Widget editor -->
              <div v-if="expandedWidgetId === widget.id" class="py-4 space-y-4">

                <!-- Identity -->
                <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <UFormField label="Title"><UInput v-model="widget.title" class="w-full" /></UFormField>
                  <UFormField label="Icon">
                    <IconPicker v-model="widget.icon" placeholder="i-lucide-hash" />
                  </UFormField>
                  <UFormField label="Chart type">
                    <USelectMenu
                      :model-value="widget.chart_kind"
                      :items="CHART_KINDS"
                      value-key="value"
                      label-key="label"
                      class="w-full"
                      @update:model-value="(v: string) => onChartKindChange(widget, v)"
                    />
                  </UFormField>
                  <UFormField label="Dataset">
                    <USelectMenu v-model="widget.dataset" :items="DATASETS" value-key="value" label-key="label" class="w-full" />
                  </UFormField>
                </div>
                <UFormField
                  v-if="isChartWidget(widget.chart_kind)"
                  label="Display size"
                  :help="WIDGET_SIZES.find((s) => s.value === (widget.size ?? 'standard'))?.help"
                >
                  <USelectMenu
                    v-model="widget.size"
                    :items="WIDGET_SIZES"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                  />
                </UFormField>

                <!-- Data (chart-type aware) -->
                <div class="space-y-3 pt-4 border-t border-default/60">
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-[11px] font-semibold text-muted uppercase tracking-wider">Data</p>
                    <p class="text-[11px] text-muted text-right max-w-sm">{{ chartProfile(widget.chart_kind).hint }}</p>
                  </div>

                  <div v-if="widgetConfigIssues(widget).length" class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <span class="font-medium">Required: </span>{{ widgetConfigIssues(widget).join(' · ') }}
                  </div>

                  <template v-if="chartProfile(widget.chart_kind).measure">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <UFormField label="Measure" help="Count cases with 'Cases (id)'.">
                        <USelectMenu v-model="widget.measure" :items="MEASURES" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                      <UFormField v-if="chartProfile(widget.chart_kind).aggregation" label="Aggregation">
                        <USelectMenu v-model="widget.aggregation" :items="AGGREGATIONS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                    </div>
                  </template>

                  <template v-if="supportsGeoCategory(widget.chart_kind)">
                    <UFormField
                      label="Break down by"
                      help="Case field uses a cases-table column. Admin unit level rolls cases up to County, Ward, Settlement, etc."
                    >
                      <USelectMenu
                        :model-value="widgetCategoryMode(widget)"
                        :items="CATEGORY_MODES"
                        value-key="value"
                        label-key="label"
                        class="w-full"
                        @update:model-value="(v: 'field' | 'unit_level') => setWidgetCategoryMode(widget, v)"
                      />
                    </UFormField>
                    <UFormField
                      v-if="widgetCategoryMode(widget) === 'unit_level'"
                      label="Unit level"
                      :help="widgetUnitLevelHelp(widget)"
                    >
                      <USelectMenu
                        :model-value="widget.unit_level ?? defaultWidgetUnitLevel()"
                        :items="hierarchyLevelItems"
                        value-key="value"
                        label-key="label"
                        placeholder="Pick level…"
                        class="w-full"
                        @update:model-value="(v: string) => onWidgetUnitLevelChange(widget, v)"
                      />
                    </UFormField>
                  </template>

                  <UFormField
                    v-if="widget.chart_kind === 'map'"
                    label="Region level"
                    :help="widgetUnitLevelHelp(widget)"
                    :required="chartProfile(widget.chart_kind).categories.required"
                  >
                    <USelectMenu
                      :model-value="widget.unit_level ?? defaultWidgetUnitLevel()"
                      :items="hierarchyLevelItems"
                      value-key="value"
                      label-key="label"
                      placeholder="Pick level…"
                      class="w-full"
                      @update:model-value="(v: string) => onWidgetUnitLevelChange(widget, v)"
                    />
                  </UFormField>

                  <UFormField
                    v-if="chartProfile(widget.chart_kind).categories.show && (isStackedChart(widget.chart_kind) || widgetCategoryMode(widget) === 'field')"
                    :label="chartProfile(widget.chart_kind).categories.label"
                    :help="chartProfile(widget.chart_kind).categories.help"
                    :required="chartProfile(widget.chart_kind).categories.required"
                  >
                    <USelectMenu
                      :model-value="categoryDim(widget)"
                      :items="categoryFieldOptions(widget)"
                      value-key="value"
                      label-key="label"
                      :placeholder="isStackedChart(widget.chart_kind) ? 'Pick field or unit level…' : 'Pick case field…'"
                      class="w-full"
                      @update:model-value="(v: string) => setCategoryDim(widget, v)"
                    />
                  </UFormField>

                  <UFormField
                    v-if="chartProfile(widget.chart_kind).series.show"
                    :label="chartProfile(widget.chart_kind).series.label"
                    :help="chartProfile(widget.chart_kind).series.help"
                    :required="chartProfile(widget.chart_kind).series.required"
                  >
                    <USelectMenu
                      :model-value="seriesValue(widget)"
                      :items="seriesFieldOptions(widget)"
                      value-key="value"
                      label-key="label"
                      placeholder="Pick case field…"
                      class="w-full"
                      @update:model-value="(v: string) => setSeriesValue(widget, v)"
                    />
                  </UFormField>

                  <template v-if="chartProfile(widget.chart_kind).time.show">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <UFormField label="Time dimension" :required="chartProfile(widget.chart_kind).time.required" help="X-axis for trend charts.">
                        <USelectMenu v-model="widget.time_dimension" :items="TIME_DIMENSIONS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                      <UFormField label="Bucket" :required="chartProfile(widget.chart_kind).time.required" help="How dates are grouped.">
                        <USelectMenu v-model="widget.bucket" :items="TIME_BUCKETS" value-key="value" label-key="label" class="w-full" />
                      </UFormField>
                    </div>
                  </template>
                </div>

                <!-- Filters -->
                <div v-if="chartProfile(widget.chart_kind).filters" class="space-y-2 pt-4 border-t border-default/60">
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
                        @update:model-value="(v) => { f.value = ''; if (fieldType(v) === 'enum' || fieldType(v) === 'unit') ensureFieldValues(v); }"
                      />
                    </UFormField>
                    <UFormField label="Operator">
                      <USelectMenu v-model="f.op" :items="FILTER_OPS" value-key="value" label-key="label" class="w-full" />
                    </UFormField>
                    <UFormField label="Value">
                      <!-- ENUM: multi-select for all ops except lt/gt/between -->
                      <template v-if="fieldType(f.field) === 'enum'">
                        <USelectMenu
                          v-if="!['lt', 'gt', 'between'].includes(f.op)"
                          :model-value="valueAsArray(f.value)"
                          :items="fvItems(f.field)"
                          multiple
                          placeholder="Pick value(s)…"
                          class="w-full"
                          @update:model-value="(v: string[]) => (f.value = v)"
                        />
                        <UInput
                          v-else
                          :model-value="String(f.value ?? '')"
                          class="w-full text-xs"
                          placeholder="value"
                          @update:model-value="f.value = $event"
                        />
                      </template>
                      <!-- UNIT: pick from jurisdiction tree (filter includes subtree) -->
                      <USelectMenu
                        v-else-if="fieldType(f.field) === 'unit'"
                        :model-value="valueAsArray(f.value)"
                        :items="fvUnitItems(f.field)"
                        value-key="value"
                        label-key="label"
                        :multiple="!['lt', 'gt', 'between'].includes(f.op)"
                        placeholder="Pick unit(s)…"
                        class="w-full"
                        @update:model-value="(v: string | string[]) => (f.value = Array.isArray(v) ? v : v ? [v] : [])"
                      />
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

                <!-- KPI / gauge display options -->
                <div v-if="hasTargetConfig(widget.chart_kind)" class="space-y-3 pt-4 border-t border-default/60">
                  <p class="text-[11px] font-semibold text-muted uppercase tracking-wider">Display</p>
                  <UFormField
                    label="Target"
                    :help="widget.chart_kind === 'gauge' ? 'Denominator for the gauge percentage (actual ÷ target × 100).' : 'Numeric goal shown as progress.'"
                  >
                    <UInput v-model.number="widget.target" type="number" min="1" class="w-full" placeholder="e.g. 100" />
                  </UFormField>
                  <UFormField
                    v-if="widget.chart_kind === 'gauge'"
                    label="Gauge style"
                    help="Visual variant — all use the same % of target calculation."
                  >
                    <USelectMenu
                      v-model="widget.gauge_variant"
                      :items="[...GAUGE_VARIANTS]"
                      value-key="value"
                      label-key="label"
                      placeholder="Basic"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    v-if="widget.chart_kind === 'gauge' && (widget.gauge_variant ?? 'basic') === 'custom_label'"
                    label="Center label"
                    help="Shown in the middle of the gauge (defaults to widget title)."
                  >
                    <UInput v-model="widget.gauge_label" class="w-full" :placeholder="widget.title" />
                  </UFormField>
                  <UFormField
                    v-if="widget.chart_kind === 'kpi_spark'"
                    label="Sparkline period"
                    help="Mini trend under the KPI — uses the same filters as the card total."
                    required
                  >
                    <USelectMenu
                      v-model="widget.sparkline_period"
                      :items="SPARKLINE_PERIODS.filter((p) => p.value)"
                      value-key="value"
                      label-key="label"
                      placeholder="Last 7 days"
                      class="w-full"
                    />
                  </UFormField>
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-muted">Thresholds</span>
                      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addThreshold(widget)">Add</UButton>
                    </div>
                    <p v-if="widget.chart_kind === 'gauge'" class="text-[11px] text-muted">Colour bands by % of target (0–100).</p>
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
