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
  drill_down?: string | null;
  caption?: string | null;
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
  filter_bar?: { period?: boolean; unit?: boolean; category?: boolean };
  sections: Section[];
}
