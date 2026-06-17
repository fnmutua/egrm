import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import type { Cd02Hierarchy } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';

type UnitRow = {
  id: string;
  levelCode: string;
  parentId: string | null;
  name: string;
};

export interface AssignableUnitSearchResult {
  id: string;
  name: string;
  levelCode: string;
  levelLabel: string;
  breadcrumb: string;
}

function levelLabel(hierarchy: Cd02Hierarchy, code: string): string {
  const level = hierarchy.levels.find((l) => l.code.toLowerCase() === code.toLowerCase());
  return level?.label ?? code;
}

async function loadAncestorMap(tenantId: string, seeds: UnitRow[]): Promise<Map<string, UnitRow>> {
  const byId = new Map<string, UnitRow>();
  for (const u of seeds) byId.set(u.id, u);

  let pending = new Set(
    seeds.map((u) => u.parentId).filter((id): id is string => Boolean(id && !byId.has(id))),
  );

  while (pending.size > 0) {
    const ids = [...pending];
    pending = new Set();
    const rows = await db
      .select({
        id: schema.unit.id,
        levelCode: schema.unit.levelCode,
        parentId: schema.unit.parentId,
        name: schema.unit.name,
      })
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, tenantId), inArray(schema.unit.id, ids)));

    for (const row of rows) {
      byId.set(row.id, row);
      if (row.parentId && !byId.has(row.parentId)) pending.add(row.parentId);
    }
  }

  return byId;
}

function breadcrumbFor(unit: UnitRow, byId: Map<string, UnitRow>, hierarchy: Cd02Hierarchy): string {
  const parts: string[] = [];
  let current = unit.parentId ? byId.get(unit.parentId) : null;
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  const lvl = levelLabel(hierarchy, unit.levelCode);
  return parts.length ? `${parts.join(' · ')} · ${unit.name}` : `${unit.name} (${lvl})`;
}

function toResults(rows: UnitRow[], hierarchy: Cd02Hierarchy, byId: Map<string, UnitRow>): AssignableUnitSearchResult[] {
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    levelCode: u.levelCode,
    levelLabel: levelLabel(hierarchy, u.levelCode),
    breadcrumb: breadcrumbFor(u, byId, hierarchy),
  }));
}

const unitSelect = {
  id: schema.unit.id,
  levelCode: schema.unit.levelCode,
  parentId: schema.unit.parentId,
  name: schema.unit.name,
};

/** Search jurisdiction units for staff role assignment (all hierarchy levels). */
export async function searchAssignableUnits(
  tenantId: string,
  opts: { q?: string; id?: string; limit?: number },
): Promise<AssignableUnitSearchResult[]> {
  const hierarchy = await getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy');
  if (!hierarchy) return [];

  const baseWhere = and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.active, true));

  if (opts.id) {
    const [row] = await db
      .select(unitSelect)
      .from(schema.unit)
      .where(and(baseWhere, eq(schema.unit.id, opts.id)))
      .limit(1);
    if (!row) return [];
    const byId = await loadAncestorMap(tenantId, [row]);
    return toResults([row], hierarchy, byId);
  }

  const q = opts.q?.trim() ?? '';
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 50);

  const rows = q.length >= 2
    ? await db
        .select(unitSelect)
        .from(schema.unit)
        .where(and(baseWhere, ilike(schema.unit.name, `%${q}%`)))
        .orderBy(asc(schema.unit.name))
        .limit(limit)
    : await db
        .select(unitSelect)
        .from(schema.unit)
        .where(baseWhere)
        .orderBy(asc(schema.unit.name))
        .limit(limit);

  if (!rows.length) return [];
  const byId = await loadAncestorMap(tenantId, rows);
  return toResults(rows, hierarchy, byId);
}
