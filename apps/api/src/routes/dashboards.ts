import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { expandUnitSubtrees, loadUserAccess, sensitivityListFilter } from '../services/access.js';

// ---- Column map: widget dimension → grm_case column ----

const GROUP_COLUMN: Record<string, string> = {
  status: 'status',
  status_tag: 'status_tag',
  channel: 'channel',
  priority: 'priority',
  sensitivity: 'sensitivity',
};

const widgetBody = z.object({
  dataset: z.string(),
  measure: z.string().default('id'),
  aggregation: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'pct']).default('count'),
  group_by: z.array(z.string()).default([]),
  time_dimension: z.string().optional(),
  bucket: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.string(),
        value: z.unknown(),
      }),
    )
    .default([]),
});

export default async function dashboardRoutes(app: FastifyInstance) {
  // Widget data query — executes a declarative widget definition against the semantic layer.
  app.post(
    '/api/v1/dashboards/widget',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const parsed = widgetBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_widget', issues: parsed.error.issues });

      const widget = parsed.data;
      const tenantId = req.tenant.id;

      // Only `cases` dataset is implemented in this phase.
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

      // Static widget filters.
      for (const f of widget.filters) {
        const col = GROUP_COLUMN[f.field];
        if (!col) continue;
        if (f.op === 'eq' && typeof f.value === 'string') {
          conditions.push(sql`${sql.identifier(col)} = ${f.value}`);
        } else if (f.op === 'neq' && typeof f.value === 'string') {
          conditions.push(sql`${sql.identifier(col)} != ${f.value}`);
        } else if (f.op === 'in' && Array.isArray(f.value)) {
          conditions.push(sql`${sql.identifier(col)} = ANY(${f.value})`);
        }
      }

      const where = and(...conditions);

      // ---- Grouped query ----
      const groupDim = widget.group_by.find((d) => GROUP_COLUMN[d]);

      if (groupDim && GROUP_COLUMN[groupDim]) {
        const col = GROUP_COLUMN[groupDim]!;
        const rows = await db
          .select({
            label: sql<string>`${sql.raw(col)}`,
            value: count(schema.grmCase.id),
          })
          .from(schema.grmCase)
          .where(where)
          .groupBy(sql.raw(col))
          .orderBy(sql`value DESC`);

        const total = rows.reduce((s, r) => s + Number(r.value), 0);
        return { rows, total };
      }

      // Time-series query.
      if (widget.time_dimension && widget.bucket) {
        const timeDims: Record<string, string> = {
          submitted_at: 'created_at',
          resolved_at: 'updated_at',
          closed_at: 'updated_at',
        };
        const timeCol = timeDims[widget.time_dimension] ?? 'created_at';
        const trunc = widget.bucket === 'quarter' ? 'quarter' : widget.bucket;

        const rows = await db
          .select({
            label: sql<string>`date_trunc(${trunc}, ${sql.raw(timeCol)})::text`,
            value: count(schema.grmCase.id),
          })
          .from(schema.grmCase)
          .where(where)
          .groupBy(sql`date_trunc(${trunc}, ${sql.raw(timeCol)})`)
          .orderBy(sql`1 ASC`);

        const total = rows.reduce((s, r) => s + Number(r.value), 0);
        return { rows, total };
      }

      // ---- Scalar (KPI) ----
      const [row] = await db
        .select({ value: count(schema.grmCase.id) })
        .from(schema.grmCase)
        .where(where);

      return { rows: [{ label: 'total', value: Number(row?.value ?? 0) }], total: Number(row?.value ?? 0) };
    },
  );
}
