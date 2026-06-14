export interface FilterDef {
  field: string;
  op: string;
  value: unknown;
}

export interface Threshold {
  value: number;
  color: 'success' | 'warning' | 'error';
  label?: string;
}

export interface Metric {
  measure: string;
  aggregation: string;
  label: string;
}

export interface Widget {
  id: string;
  title: string;
  icon?: string | null;
  chart_kind: string;
  dataset: string;
  measure?: string;
  aggregation?: string;
  metrics?: Metric[];
  group_by?: string[];
  time_dimension?: string;
  bucket?: string;
  filters?: FilterDef[];
  target?: number | null;
  thresholds?: Threshold[];
  /** Grid footprint + chart density: compact | standard | wide | full */
  size?: 'compact' | 'standard' | 'wide' | 'full';
  /** Admin hierarchy level for geographic breakdown — sets group_by to unit_level:{code} */
  unit_level?: string;
  /** KPI mini trend: last 7/14/30 days, 8 weeks, or 6 months. */
  sparkline_period?: '7d' | '14d' | '30d' | '8w' | '6m' | null;
  /** Gauge visual style (chart_kind === 'gauge' only). */
  gauge_variant?: 'basic' | 'custom_label' | 'needle' | 'semi';
  /** Center label for custom_label gauge variant. */
  gauge_label?: string | null;
}

export interface Section {
  id: string;
  title: string;
  icon?: string;
  color?: string;
  order: number;
  widgets: Widget[];
}

export interface Dashboard {
  id: string;
  title: string;
  icon?: string;
  audience?: { roles?: string[]; levels?: string[] };
  is_main?: boolean;
  is_public?: boolean;
  layout?: string;
  filter_bar?: { period?: boolean; unit?: boolean; category?: boolean; unit_level?: string };
  sections: Section[];
}
