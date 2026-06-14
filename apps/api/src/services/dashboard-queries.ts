import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/** Scalar columns on grm_case usable for group_by. */
export const SCALAR_DIMS: Record<string, string> = {
  status: 'status',
  status_tag: 'status_tag',
  channel: 'channel',
  priority: 'priority',
  sensitivity: 'sensitivity',
  level_code: 'level_code',
  case_type: 'case_type',
  anonymous: 'anonymous',
  assignee_id: 'assignee_id',
  party_id: 'party_id',
};

export type ParsedGroupDim =
  | { type: 'scalar'; column: string }
  | { type: 'unit_direct' }
  | { type: 'unit_level'; levelCode: string };

export function parseGroupDimension(dim: string): ParsedGroupDim | null {
  if (dim === 'unit_id') return { type: 'unit_direct' };
  if (dim.startsWith('unit_level:')) {
    const levelCode = dim.slice('unit_level:'.length).trim();
    return levelCode ? { type: 'unit_level', levelCode } : null;
  }
  const column = SCALAR_DIMS[dim];
  return column ? { type: 'scalar', column } : null;
}

export function isGroupDimension(dim: string): boolean {
  return parseGroupDimension(dim) !== null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTimeBucket(rawDate: string, bucket: string): string {
  const d = new Date(rawDate.replace(' ', 'T'));
  if (isNaN(d.getTime())) return rawDate;
  const yr = d.getUTCFullYear();
  const mo = MONTHS[d.getUTCMonth()]!;
  const day = d.getUTCDate();
  switch (bucket) {
    case 'day':     return `${mo} ${day}`;
    case 'week':    return `${mo} ${day}`;
    case 'month':   return `${mo} ${yr}`;
    case 'quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${yr}`;
    case 'year':    return String(yr);
    default:        return rawDate;
  }
}

/** Pivot flat [{cat, grp, val}] into ApexCharts multi-series format. */
export function pivot2D(raw: { cat: string; grp: string; val: unknown }[]) {
  const cats   = [...new Set(raw.map((r) => r.cat))];
  const groups = [...new Set(raw.map((r) => r.grp))];
  const byGroup = new Map<string, Map<string, number>>();
  for (const r of raw) {
    if (!byGroup.has(r.grp)) byGroup.set(r.grp, new Map());
    byGroup.get(r.grp)!.set(r.cat, Number(r.val));
  }
  return {
    categories: cats,
    series: groups.map((g) => ({
      name: g ?? '—',
      data: cats.map((c) => byGroup.get(g)?.get(c) ?? 0),
    })),
    total: raw.reduce((s, r) => s + Number(r.val), 0),
  };
}

/** Recursive CTE: each case mapped to its ancestor (or self) at the target hierarchy level. */
function unitLevelCte(tenantId: string, levelCode: string, caseWhere: SQL) {
  const level = levelCode.toLowerCase();
  return sql`
    WITH RECURSIVE case_unit_chain AS (
      SELECT
        c.id AS case_id,
        u.id AS unit_id,
        u.parent_id,
        lower(u.level_code) AS level_code,
        u.name
      FROM grm_case c
      INNER JOIN unit u ON u.id = c.unit_id AND u.tenant_id = ${tenantId}
      WHERE ${caseWhere}
      UNION ALL
      SELECT
        cuc.case_id,
        p.id,
        p.parent_id,
        lower(p.level_code),
        p.name
      FROM case_unit_chain cuc
      INNER JOIN unit p ON p.id = cuc.parent_id AND p.tenant_id = ${tenantId}
    ),
    unit_level_map AS (
      SELECT DISTINCT ON (case_id) case_id, coalesce(name, '—') AS label
      FROM case_unit_chain
      WHERE level_code = ${level}
      ORDER BY case_id, unit_id
    )
  `;
}

type Row2D = { cat: string; grp: string; val: unknown };

async function query2DWithUnitLevel(
  caseWhere: SQL,
  tenantId: string,
  levelCode: string,
  other: ParsedGroupDim,
  levelOnAxis: 'cat' | 'grp',
): Promise<Row2D[]> {
  const cte = unitLevelCte(tenantId, levelCode, caseWhere);

  if (other.type === 'scalar') {
    const col = other.column;
    const query = levelOnAxis === 'cat'
      ? sql`${cte}
          SELECT m.label AS cat, c.${sql.raw(col)} AS grp, count(c.id) AS val
          FROM grm_case c
          INNER JOIN unit_level_map m ON m.case_id = c.id
          WHERE ${caseWhere}
          GROUP BY m.label, c.${sql.raw(col)}
          ORDER BY m.label, c.${sql.raw(col)}`
      : sql`${cte}
          SELECT c.${sql.raw(col)} AS cat, m.label AS grp, count(c.id) AS val
          FROM grm_case c
          INNER JOIN unit_level_map m ON m.case_id = c.id
          WHERE ${caseWhere}
          GROUP BY c.${sql.raw(col)}, m.label
          ORDER BY c.${sql.raw(col)}, m.label`;

    const result = await db.execute(query);
    return (result.rows as Row2D[]).map((r) => ({
      cat: String(r.cat ?? '—'),
      grp: String(r.grp ?? '—'),
      val: r.val,
    }));
  }

  if (other.type === 'unit_direct') {
    const query = levelOnAxis === 'cat'
      ? sql`${cte}
          SELECT m.label AS cat, coalesce(u.name, '—') AS grp, count(c.id) AS val
          FROM grm_case c
          INNER JOIN unit_level_map m ON m.case_id = c.id
          LEFT JOIN unit u ON u.id = c.unit_id
          WHERE ${caseWhere}
          GROUP BY m.label, u.name
          ORDER BY m.label, u.name`
      : sql`${cte}
          SELECT coalesce(u.name, '—') AS cat, m.label AS grp, count(c.id) AS val
          FROM grm_case c
          INNER JOIN unit_level_map m ON m.case_id = c.id
          LEFT JOIN unit u ON u.id = c.unit_id
          WHERE ${caseWhere}
          GROUP BY u.name, m.label
          ORDER BY u.name, m.label`;

    const result = await db.execute(query);
    return (result.rows as Row2D[]).map((r) => ({
      cat: String(r.cat ?? '—'),
      grp: String(r.grp ?? '—'),
      val: r.val,
    }));
  }

  return [];
}

export async function queryGrouped2D(
  caseWhere: SQL,
  tenantId: string,
  dim0: string,
  dim1: string,
): Promise<Row2D[] | null> {
  const d0 = parseGroupDimension(dim0);
  const d1 = parseGroupDimension(dim1);
  if (!d0 || !d1) return null;

  if (d0.type === 'unit_level') return query2DWithUnitLevel(caseWhere, tenantId, d0.levelCode, d1, 'cat');
  if (d1.type === 'unit_level') return query2DWithUnitLevel(caseWhere, tenantId, d1.levelCode, d0, 'grp');

  if (d0.type === 'scalar' && d1.type === 'scalar') {
    const raw = await db
      .select({
        cat: sql<string>`${sql.raw(d0.column)}`,
        grp: sql<string>`${sql.raw(d1.column)}`,
        val: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .where(caseWhere)
      .groupBy(sql.raw(d0.column), sql.raw(d1.column))
      .orderBy(sql.raw(d0.column), sql.raw(d1.column));

    return raw.map((r) => ({ cat: String(r.cat ?? '—'), grp: String(r.grp ?? '—'), val: r.val }));
  }

  if (d0.type === 'unit_direct' && d1.type === 'scalar') {
    const raw = await db
      .select({
        cat: sql<string>`coalesce(${schema.unit.name}, '—')`,
        grp: sql<string>`${sql.raw(d1.column)}`,
        val: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(caseWhere)
      .groupBy(schema.unit.name, sql.raw(d1.column))
      .orderBy(schema.unit.name, sql.raw(d1.column));

    return raw.map((r) => ({ cat: String(r.cat ?? '—'), grp: String(r.grp ?? '—'), val: r.val }));
  }

  if (d0.type === 'scalar' && d1.type === 'unit_direct') {
    const raw = await db
      .select({
        cat: sql<string>`${sql.raw(d0.column)}`,
        grp: sql<string>`coalesce(${schema.unit.name}, '—')`,
        val: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(caseWhere)
      .groupBy(sql.raw(d0.column), schema.unit.name)
      .orderBy(sql.raw(d0.column), schema.unit.name);

    return raw.map((r) => ({ cat: String(r.cat ?? '—'), grp: String(r.grp ?? '—'), val: r.val }));
  }

  if (d0.type === 'unit_direct' && d1.type === 'unit_direct') {
    const raw = await db
      .select({
        cat: sql<string>`coalesce(${schema.unit.name}, '—')`,
        grp: sql<string>`coalesce(${schema.unit.name}, '—')`,
        val: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(caseWhere)
      .groupBy(schema.unit.name)
      .orderBy(schema.unit.name);

    return raw.map((r) => ({ cat: String(r.cat ?? '—'), grp: String(r.grp ?? '—'), val: r.val }));
  }

  return null;
}

export async function queryTimeByDimension(
  caseWhere: SQL,
  tenantId: string,
  timeCol: string,
  bucket: string,
  splitDim: string,
): Promise<Row2D[] | null> {
  const dim = parseGroupDimension(splitDim);
  if (!dim) return null;

  const timeExpr = sql`date_trunc(${bucket}, ${sql.raw(timeCol)})`;

  if (dim.type === 'unit_level') {
    const cte = unitLevelCte(tenantId, dim.levelCode, caseWhere);
    const query = sql`${cte}
      SELECT ${timeExpr}::text AS cat, m.label AS grp, count(c.id) AS val
      FROM grm_case c
      INNER JOIN unit_level_map m ON m.case_id = c.id
      WHERE ${caseWhere}
      GROUP BY ${timeExpr}, m.label
      ORDER BY ${timeExpr}, m.label`;

    const result = await db.execute(query);
    return (result.rows as Row2D[]).map((r) => ({
      cat: formatTimeBucket(String(r.cat ?? ''), bucket),
      grp: String(r.grp ?? '—'),
      val: r.val,
    }));
  }

  if (dim.type === 'unit_direct') {
    const raw = await db
      .select({
        cat: sql<string>`${timeExpr}::text`,
        grp: sql<string>`coalesce(${schema.unit.name}, '—')`,
        val: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(caseWhere)
      .groupBy(timeExpr, schema.unit.name)
      .orderBy(timeExpr, schema.unit.name);

    return raw.map((r) => ({
      cat: formatTimeBucket(String(r.cat ?? ''), bucket),
      grp: String(r.grp ?? '—'),
      val: r.val,
    }));
  }

  const raw = await db
    .select({
      cat: sql<string>`${timeExpr}::text`,
      grp: sql<string>`${sql.raw(dim.column)}`,
      val: count(schema.grmCase.id),
    })
    .from(schema.grmCase)
    .where(caseWhere)
    .groupBy(timeExpr, sql.raw(dim.column))
    .orderBy(timeExpr, sql.raw(dim.column));

  return raw.map((r) => ({
    cat: formatTimeBucket(String(r.cat ?? ''), bucket),
    grp: String(r.grp ?? '—'),
    val: r.val,
  }));
}

export async function queryGrouped1D(
  caseWhere: SQL,
  tenantId: string,
  dim: string,
): Promise<{ label: string; value: number }[] | null> {
  const parsed = parseGroupDimension(dim);
  if (!parsed) return null;

  if (parsed.type === 'unit_level') {
    const cte = unitLevelCte(tenantId, parsed.levelCode, caseWhere);
    const query = sql`${cte}
      SELECT label, count(*)::int AS value
      FROM unit_level_map
      GROUP BY label
      ORDER BY 2 DESC
      LIMIT 200`;

    const result = await db.execute(query);
    return (result.rows as { label: string; value: number }[]).map((r) => ({
      label: String(r.label ?? '—'),
      value: Number(r.value ?? 0),
    }));
  }

  if (parsed.type === 'unit_direct') {
    const rows = await db
      .select({
        label: sql<string>`coalesce(${schema.unit.name}, '—')`,
        value: count(schema.grmCase.id),
      })
      .from(schema.grmCase)
      .leftJoin(schema.unit, eq(schema.grmCase.unitId, schema.unit.id))
      .where(caseWhere)
      .groupBy(schema.unit.name)
      .orderBy(sql`2 DESC`)
      .limit(200);

    return rows.map((r) => ({ label: String(r.label ?? '—'), value: Number(r.value) }));
  }

  const rows = await db
    .select({
      label: sql<string>`${sql.raw(parsed.column)}`,
      value: count(schema.grmCase.id),
    })
    .from(schema.grmCase)
    .where(caseWhere)
    .groupBy(sql.raw(parsed.column))
    .orderBy(sql`2 DESC`)
    .limit(200);

  return rows.map((r) => ({ label: String(r.label ?? '—'), value: Number(r.value) }));
}

export async function queryTimeSeries1D(
  caseWhere: SQL,
  timeCol: string,
  bucket: string,
): Promise<{ label: string; value: number }[]> {
  const rows = await db
    .select({
      label: sql<string>`date_trunc(${bucket}, ${sql.raw(timeCol)})::text`,
      value: count(schema.grmCase.id),
    })
    .from(schema.grmCase)
    .where(caseWhere)
    .groupBy(sql`date_trunc(${bucket}, ${sql.raw(timeCol)})`)
    .orderBy(sql`1 ASC`);

  return rows.map((r) => ({
    label: formatTimeBucket(String(r.label ?? ''), bucket),
    value: Number(r.value),
  }));
}
