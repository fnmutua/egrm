import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd02Hierarchy } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { expandUnitSubtrees, loadUserAccess, sensitivityListFilter } from '../services/access.js';
import { getActiveConfig } from '../services/config.js';
import {
  isGroupDimension,
  pivot2D,
  queryGrouped1D,
  queryGrouped2D,
  queryTimeByDimension,
  queryTimeSeries1D,
  SCALAR_DIMS,
} from '../services/dashboard-queries.js';

/** Time-dimension key → actual DB column name. */
const TIME_COLS: Record<string, string> = {
  submitted_at:      'created_at',
  resolved_at:       'updated_at',
  closed_at:         'updated_at',
  acknowledged_at:   'updated_at',
  first_response_at: 'updated_at',
};

/** All filterable fields with column metadata. */
const FILTERABLE: Record<string, { col: string; isArray?: true; isBool?: true }> = {
  status:      { col: 'status' },
  status_tag:  { col: 'status_tag' },
  channel:     { col: 'channel' },
  priority:    { col: 'priority' },
  sensitivity: { col: 'sensitivity' },
  level_code:  { col: 'level_code' },
  unit_id:     { col: 'unit_id' },
  anonymous:   { col: 'anonymous', isBool: true },
  category:    { col: 'categories', isArray: true },
};

const widgetBody = z.object({
  dataset: z.string(),
  chart_kind: z.string().optional(),
  measure: z.string().default('id'),
  aggregation: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'pct']).default('count'),
  group_by: z.array(z.string()).default([]),
  time_dimension: z.string().optional(),
  bucket: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  filters: z
    .array(z.object({ field: z.string(), op: z.string(), value: z.unknown() }))
    .default([]),
});

const CATEGORICAL_CHARTS = new Set(['table', 'bar', 'pie', 'donut', 'treemap', 'map', 'pyramid']);
const STACKED_CHARTS = new Set(['stacked_bar', 'stacked_bar_100']);
const TIME_SPLIT_CHARTS = new Set(['multi_line', 'area']);
const TIME_ONLY_CHARTS = new Set(['line']);

function primaryGroupDim(groupBy: string[]): string | undefined {
  return groupBy.find((d) => isGroupDimension(d)) ?? groupBy[0];
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function buildFilterCondition(f: { field: string; op: string; value: unknown }) {
  const meta = FILTERABLE[f.field];
  if (!meta) return null;

  const col = sql.identifier(meta.col);

  if (meta.isBool) {
    const bv = toBool(f.value);
    if (f.op === 'eq')  return sql`${col} = ${bv}`;
    if (f.op === 'neq') return sql`${col} != ${bv}`;
    return null;
  }

  if (meta.isArray) {
    const vals = toArray(f.value);
    if (!vals.length) return null;
    if (f.op === 'eq')  return sql`${vals[0]} = ANY(${col})`;
    if (f.op === 'neq') return sql`NOT (${vals[0]} = ANY(${col}))`;
    if (f.op === 'in')  return sql`${col} && ${vals}::text[]`;
    if (f.op === 'nin') return sql`NOT (${col} && ${vals}::text[])`;
    return null;
  }

  const sv = typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : null;

  if (f.op === 'eq' || f.op === 'neq') {
    const vals = toArray(f.value);
    if (!vals.length && sv === null) return null;
    const list = vals.length ? vals : (sv ? [sv] : []);
    if (!list.length) return null;
    if (f.op === 'eq')  return list.length === 1 ? sql`${col} = ${list[0]}` : sql`${col} = ANY(${list}::text[])`;
    if (f.op === 'neq') return list.length === 1 ? sql`${col} != ${list[0]}` : sql`${col} != ALL(${list}::text[])`;
  }

  if (f.op === 'lt'  && sv !== null) return sql`${col} < ${sv}`;
  if (f.op === 'gt'  && sv !== null) return sql`${col} > ${sv}`;

  if (f.op === 'in' || f.op === 'nin') {
    const vals = toArray(f.value);
    if (!vals.length) return null;
    if (f.op === 'in')  return sql`${col} = ANY(${vals}::text[])`;
    if (f.op === 'nin') return sql`${col} != ALL(${vals}::text[])`;
  }

  if (f.op === 'between') {
    const arr = toArray(f.value);
    if (arr.length === 2) return sql`${col} BETWEEN ${arr[0]} AND ${arr[1]}`;
  }

  return null;
}

async function buildCaseWhere(
  tenantId: string,
  userId: string,
  filters: { field: string; op: string; value: unknown }[],
) {
  const access = await loadUserAccess(userId, tenantId);
  const allowedUnits = access.tenantWide
    ? null
    : await expandUnitSubtrees(tenantId, access.jurisdictionRoots);

  const conditions = [eq(schema.grmCase.tenantId, tenantId)];

  if (allowedUnits !== null) {
    conditions.push(
      allowedUnits.size > 0
        ? inArray(schema.grmCase.unitId, [...allowedUnits])
        : sql`false`,
    );
  }

  conditions.push(sensitivityListFilter(access, userId));

  for (const f of filters) {
    if (f.field === 'unit_id' && ['eq', 'in'].includes(f.op)) {
      const roots = toArray(f.value);
      if (!roots.length && typeof f.value === 'string' && f.value) roots.push(f.value);
      if (roots.length) {
        const expanded = new Set<string>();
        for (const root of roots) {
          for (const id of await expandUnitSubtrees(tenantId, [root])) expanded.add(id);
        }
        if (expanded.size) conditions.push(inArray(schema.grmCase.unitId, [...expanded]));
      }
      continue;
    }

    if (f.field === 'unit_id' && ['neq', 'nin'].includes(f.op)) {
      const roots = toArray(f.value);
      if (!roots.length && typeof f.value === 'string' && f.value) roots.push(f.value);
      if (roots.length) {
        const expanded = new Set<string>();
        for (const root of roots) {
          for (const id of await expandUnitSubtrees(tenantId, [root])) expanded.add(id);
        }
        if (expanded.size) conditions.push(sql`NOT (${schema.grmCase.unitId} = ANY(${[...expanded]}::uuid[]))`);
      }
      continue;
    }

    const cond = buildFilterCondition(f);
    if (cond) conditions.push(cond);
  }

  return and(...conditions)!;
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    '/api/v1/dashboards/dimensions',
    { onRequest: [app.authenticate] },
    async (req) => {
      const hierarchy = await getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy');
      const levels = hierarchy?.levels ?? [];

      const caseDimensionLabels: Record<string, string> = {
        status: 'Status',
        status_tag: 'Status tag',
        channel: 'Channel',
        priority: 'Priority',
        sensitivity: 'Sensitivity',
        level_code: 'Case level',
        case_type: 'Case type',
        anonymous: 'Anonymous',
        assignee_id: 'Assignee',
        party_id: 'Complainant',
        unit_id: 'Unit',
      };

      const caseFields = [
        ...Object.keys(SCALAR_DIMS).map((value) => ({
          value,
          label: caseDimensionLabels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          group: 'case' as const,
        })),
        { value: 'unit_id', label: 'Unit', group: 'case' as const },
      ];

      const unitRollups = [...levels].reverse().map((l) => ({
        value: `unit_level:${l.code}`,
        label: l.label || l.code,
        group: 'unit_rollup' as const,
      }));

      return {
        case_fields: caseFields,
        case_dimensions: caseFields,
        unit_rollups: unitRollups,
        unit_dimensions: unitRollups,
      };
    },
  );

  app.post(
    '/api/v1/dashboards/widget',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const parsed = widgetBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_widget', issues: parsed.error.issues });

      const widget = parsed.data;
      const tenantId = req.tenant.id;

      if (widget.dataset !== 'cases') {
        return { rows: [], total: 0, note: `Dataset '${widget.dataset}' not yet available.` };
      }

      const where = await buildCaseWhere(tenantId, req.user.sub, widget.filters as { field: string; op: string; value: unknown }[]);
      const kind = widget.chart_kind ?? '';

      // Stacked bars — always 2D; never fall through to 1D or time-series paths
      if (STACKED_CHARTS.has(kind)) {
        if (widget.group_by.length >= 2) {
          const dim0 = widget.group_by[0]!;
          const dim1 = widget.group_by[1]!;
          if (isGroupDimension(dim0) && isGroupDimension(dim1)) {
            const raw = await queryGrouped2D(where, tenantId, dim0, dim1);
            if (raw?.length) {
              const { series, categories, total } = pivot2D(raw);
              return { rows: [], series, categories, total };
            }
          }
        }
        return { rows: [], series: [], categories: [], total: 0 };
      }

      // Table, bar, pie, etc. — always 1D rows; ignore stray time fields from old configs
      if (CATEGORICAL_CHARTS.has(kind)) {
        const groupDim = primaryGroupDim(widget.group_by);
        if (groupDim && isGroupDimension(groupDim)) {
          const rows = await queryGrouped1D(where, tenantId, groupDim);
          if (rows) {
            return { rows, series: [], categories: [], total: rows.reduce((s, r) => s + Number(r.value), 0) };
          }
        }
      }

      if (TIME_SPLIT_CHARTS.has(kind) && widget.time_dimension && widget.bucket) {
        const splitDim = primaryGroupDim(widget.group_by);
        if (splitDim && isGroupDimension(splitDim)) {
          const timeCol = TIME_COLS[widget.time_dimension] ?? 'created_at';
          const raw = await queryTimeByDimension(where, tenantId, timeCol, widget.bucket, splitDim);
          if (raw) {
            const { series, categories, total } = pivot2D(raw);
            return { rows: [], series, categories, total };
          }
        }
      }

      if (widget.group_by.length >= 2) {
        const raw = await queryGrouped2D(where, tenantId, widget.group_by[0]!, widget.group_by[1]!);
        if (raw) {
          const { series, categories, total } = pivot2D(raw);
          return { rows: [], series, categories, total };
        }
      }

      const groupDim = primaryGroupDim(widget.group_by);
      if (groupDim && isGroupDimension(groupDim)) {
        const rows = await queryGrouped1D(where, tenantId, groupDim);
        if (rows) {
          return { rows, series: [], categories: [], total: rows.reduce((s, r) => s + Number(r.value), 0) };
        }
      }

      if (TIME_ONLY_CHARTS.has(kind) && widget.time_dimension && widget.bucket) {
        const timeCol = TIME_COLS[widget.time_dimension] ?? 'created_at';
        const rows = await queryTimeSeries1D(where, timeCol, widget.bucket);
        return { rows, series: [], categories: [], total: rows.reduce((s, r) => s + Number(r.value), 0) };
      }

      if (widget.time_dimension && widget.bucket) {
        const timeCol = TIME_COLS[widget.time_dimension] ?? 'created_at';
        const rows = await queryTimeSeries1D(where, timeCol, widget.bucket);
        return { rows, series: [], categories: [], total: rows.reduce((s, r) => s + Number(r.value), 0) };
      }

      const [row] = await db
        .select({ value: count(schema.grmCase.id) })
        .from(schema.grmCase)
        .where(where);

      const total = Number(row?.value ?? 0);
      return { rows: [{ label: 'total', value: total }], series: [], categories: [], total };
    },
  );

  app.get(
    '/api/v1/dashboards/field-values',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { dataset = 'cases', field } = req.query as { dataset?: string; field?: string };
      if (!field) return { values: [] };
      const meta = FILTERABLE[field];
      if (!meta || dataset !== 'cases') return { values: [] };

      const tenantId = req.tenant.id;

      if (field === 'unit_id') {
        const rows = await db
          .select({ id: schema.unit.id, name: schema.unit.name, levelCode: schema.unit.levelCode })
          .from(schema.unit)
          .where(and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.active, true)))
          .orderBy(schema.unit.name)
          .limit(500);
        return {
          values: rows.map((r) => r.id),
          labels: Object.fromEntries(rows.map((r) => [r.id, `${r.name} (${r.levelCode})`])),
        };
      }

      if (meta.isBool) return { values: ['true', 'false'] };

      const colExpr = sql.identifier(meta.col);

      if (meta.isArray) {
        const rows = await db
          .selectDistinct({ val: sql<string>`unnest(${colExpr})` })
          .from(schema.grmCase)
          .where(eq(schema.grmCase.tenantId, tenantId))
          .orderBy(sql`1`)
          .limit(200);
        return { values: rows.map((r) => r.val).filter(Boolean) };
      }

      const rows = await db
        .selectDistinct({ val: sql<string>`${colExpr}` })
        .from(schema.grmCase)
        .where(eq(schema.grmCase.tenantId, tenantId))
        .orderBy(sql`1`)
        .limit(200);
      return { values: rows.map((r) => r.val).filter(Boolean) };
    },
  );
}
