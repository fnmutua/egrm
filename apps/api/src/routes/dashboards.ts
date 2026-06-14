import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { expandUnitSubtrees, loadUserAccess, sensitivityListFilter } from '../services/access.js';

// ---- Semantic layer: dimension → DB column ----

/** Columns usable for group_by (scalar text/enum). */
const GROUP_COLUMN: Record<string, string> = {
  status:      'status',
  status_tag:  'status_tag',
  channel:     'channel',
  priority:    'priority',
  sensitivity: 'sensitivity',
  level_code:  'level_code',
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

// ---- Request schema ----

const widgetBody = z.object({
  dataset: z.string(),
  measure: z.string().default('id'),
  aggregation: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'pct']).default('count'),
  group_by: z.array(z.string()).default([]),
  time_dimension: z.string().optional(),
  bucket: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  filters: z
    .array(z.object({ field: z.string(), op: z.string(), value: z.unknown() }))
    .default([]),
});

// ---- Helpers ----

/** Coerce a filter value to a string array (handles comma-separated strings too). */
function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** Build a SQL condition for a single widget filter. Returns null if the filter is unsupported/empty. */
function buildFilterCondition(f: { field: string; op: string; value: unknown }) {
  const meta = FILTERABLE[f.field];
  if (!meta) return null;

  const col = sql.identifier(meta.col);

  // ── Boolean column ──────────────────────────────────────────
  if (meta.isBool) {
    const bv = toBool(f.value);
    if (f.op === 'eq')  return sql`${col} = ${bv}`;
    if (f.op === 'neq') return sql`${col} != ${bv}`;
    return null;
  }

  // ── Array column (categories: text[]) ──────────────────────
  if (meta.isArray) {
    const vals = toArray(f.value);
    if (!vals.length) return null;
    if (f.op === 'eq')  return sql`${vals[0]} = ANY(${col})`;
    if (f.op === 'neq') return sql`NOT (${vals[0]} = ANY(${col}))`;
    // in: any of the given values appears in the array (overlap)
    if (f.op === 'in')  return sql`${col} && ${vals}::text[]`;
    if (f.op === 'nin') return sql`NOT (${col} && ${vals}::text[])`;
    return null;
  }

  // ── Scalar column (text / uuid / enum) ─────────────────────
  const sv = typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : null;

  // eq/neq: if multiple values selected treat as IN / NOT IN
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

// ---- Route ----

export default async function dashboardRoutes(app: FastifyInstance) {
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

      // Row-level security: jurisdiction + sensitivity.
      const access = await loadUserAccess(req.user.sub, tenantId);
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

      conditions.push(sensitivityListFilter(access, req.user.sub));

      // Widget-level filters.
      for (const f of widget.filters) {
        const cond = buildFilterCondition(f);
        if (cond) conditions.push(cond);
      }

      const where = and(...conditions);

      // ---- Grouped query ----
      const groupDim = widget.group_by.find((d) => GROUP_COLUMN[d]);

      if (groupDim) {
        const col = GROUP_COLUMN[groupDim]!;
        const rows = await db
          .select({
            label: sql<string>`${sql.raw(col)}`,
            value: count(schema.grmCase.id),
          })
          .from(schema.grmCase)
          .where(where)
          .groupBy(sql.raw(col))
          .orderBy(sql`2 DESC`);

        return { rows, total: rows.reduce((s, r) => s + Number(r.value), 0) };
      }

      // ---- Time-series query ----
      if (widget.time_dimension && widget.bucket) {
        const timeDims: Record<string, string> = {
          submitted_at:    'created_at',
          resolved_at:     'updated_at',
          closed_at:       'updated_at',
          acknowledged_at: 'updated_at',
          first_response_at: 'updated_at',
        };
        const timeCol = timeDims[widget.time_dimension] ?? 'created_at';
        const trunc = widget.bucket;

        const rows = await db
          .select({
            label: sql<string>`date_trunc(${trunc}, ${sql.raw(timeCol)})::text`,
            value: count(schema.grmCase.id),
          })
          .from(schema.grmCase)
          .where(where)
          .groupBy(sql`date_trunc(${trunc}, ${sql.raw(timeCol)})`)
          .orderBy(sql`1 ASC`);

        return { rows, total: rows.reduce((s, r) => s + Number(r.value), 0) };
      }

      // ---- Scalar (KPI card) ----
      const [row] = await db
        .select({ value: count(schema.grmCase.id) })
        .from(schema.grmCase)
        .where(where);

      const total = Number(row?.value ?? 0);
      return { rows: [{ label: 'total', value: total }], total };
    },
  );

  // ---- Field value enumeration (for filter autocomplete) ----
  app.get(
    '/api/v1/dashboards/field-values',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { dataset = 'cases', field } = req.query as { dataset?: string; field?: string };
      if (!field) return { values: [] };
      const meta = FILTERABLE[field];
      if (!meta || dataset !== 'cases') return { values: [] };

      const tenantId = req.tenant.id;

      if (meta.isBool) return { values: ['true', 'false'] };

      const colExpr = sql.identifier(meta.col);

      if (meta.isArray) {
        // unnest expands the text[] column into individual rows
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
