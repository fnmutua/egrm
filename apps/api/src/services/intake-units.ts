import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { Cd02Hierarchy } from '@egrm/config-schemas';
import { intakeLevels as hierarchyIntakeLevels } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';

type UnitRow = {
  id: string;
  levelCode: string;
  parentId: string | null;
  name: string;
};

export interface IntakeUnitSearchResult {
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

function intakeLevelCodes(hierarchy: Cd02Hierarchy): string[] {
  return hierarchyIntakeLevels(hierarchy).map((l) => l.code.toLowerCase());
}

/** Intake level filter — falls back when CD-02 intake levels have no units in the tree. */
export async function intakeUnitLevelCodes(
  tenantId: string,
  hierarchy: Cd02Hierarchy,
): Promise<string[]> {
  const configured = intakeLevelCodes(hierarchy);
  if (!configured.length) return [];

  const unitLevels = await db
    .select({
      levelCode: schema.unit.levelCode,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.unit)
    .where(and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.active, true)))
    .groupBy(schema.unit.levelCode);

  const countByLevel = new Map(
    unitLevels.map((r) => [r.levelCode.toLowerCase(), Number(r.n)]),
  );

  const configuredWithUnits = configured.filter((c) => (countByLevel.get(c) ?? 0) > 0);
  if (configuredWithUnits.length > 0) return configuredWithUnits;

  for (const level of hierarchy.levels) {
    const code = level.code.toLowerCase();
    if ((countByLevel.get(code) ?? 0) > 0) return [code];
  }

  return configured;
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

function toResults(rows: UnitRow[], hierarchy: Cd02Hierarchy, byId: Map<string, UnitRow>): IntakeUnitSearchResult[] {
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    levelCode: u.levelCode,
    levelLabel: levelLabel(hierarchy, u.levelCode),
    breadcrumb: breadcrumbFor(u, byId, hierarchy),
  }));
}

export async function searchIntakeUnits(
  tenantId: string,
  opts: { q?: string; id?: string; limit?: number },
): Promise<IntakeUnitSearchResult[]> {
  const hierarchy = await getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy');
  if (!hierarchy) return [];

  const levelCodes = await intakeUnitLevelCodes(tenantId, hierarchy);
  if (!levelCodes.length) return [];

  const levelFilter = sql`lower(${schema.unit.levelCode}) in (${sql.join(
    levelCodes.map((c) => sql`${c}`),
    sql`, `,
  )})`;

  const baseWhere = and(
    eq(schema.unit.tenantId, tenantId),
    eq(schema.unit.active, true),
    levelFilter,
  );

  if (opts.id) {
    const [row] = await db
      .select({
        id: schema.unit.id,
        levelCode: schema.unit.levelCode,
        parentId: schema.unit.parentId,
        name: schema.unit.name,
      })
      .from(schema.unit)
      .where(and(baseWhere, eq(schema.unit.id, opts.id)))
      .limit(1);
    if (!row) return [];
    const byId = await loadAncestorMap(tenantId, [row]);
    return toResults([row], hierarchy, byId);
  }

  const q = opts.q?.trim() ?? '';
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 50);

  if (q.length < 2) {
    const rows = await db
      .select({
        id: schema.unit.id,
        levelCode: schema.unit.levelCode,
        parentId: schema.unit.parentId,
        name: schema.unit.name,
      })
      .from(schema.unit)
      .where(baseWhere)
      .orderBy(asc(schema.unit.name))
      .limit(limit);

    if (!rows.length) return [];
    const byId = await loadAncestorMap(tenantId, rows);
    return toResults(rows, hierarchy, byId);
  }

  const allUnits = await loadIntakeUnitResults(tenantId, hierarchy, baseWhere, 500);
  const ranked = rankUnitsByQuery(allUnits, q, limit);
  if (ranked.length > 0) return ranked;

  const rows = await db
    .select({
      id: schema.unit.id,
      levelCode: schema.unit.levelCode,
      parentId: schema.unit.parentId,
      name: schema.unit.name,
    })
    .from(schema.unit)
    .where(and(baseWhere, ilike(schema.unit.name, `%${q}%`)))
    .orderBy(asc(schema.unit.name))
    .limit(limit);

  if (!rows.length) return [];
  const byId = await loadAncestorMap(tenantId, rows);
  return toResults(rows, hierarchy, byId);
}

const LOCATION_STOP_WORDS = new Set([
  'settlement',
  'location',
  'the',
  'in',
  'at',
  'and',
  'my',
  'is',
  'are',
  'for',
  'from',
  'there',
  'here',
  'near',
  'area',
]);

/** Strip field labels and filler from free-text location answers in chat. */
export function parseLocationQuery(raw: string): string[] {
  let text = raw.trim();
  text = text.replace(
    /^(?:settlement\s*\/?\s*location|location|settlement|makazi|eneo)\s*[:：\-–—]\s*/i,
    '',
  );
  text = text.replace(/^settlement\s+/i, '').trim();

  const tokens = text
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^a-zA-Z0-9'-]/g, ''))
    .filter((t) => t.length >= 2 && !LOCATION_STOP_WORDS.has(t.toLowerCase()));

  const candidates = [...new Set([text, ...tokens])].filter((c) => c.length >= 2);
  return candidates.length ? candidates : text.length >= 2 ? [text] : [];
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[n]!;
}

function fuzzyWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  if (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 2) return true;
  return false;
}

function scoreUnitAgainstQuery(unit: IntakeUnitSearchResult, query: string): number {
  const qn = normalizeForMatch(query);
  if (qn.length < 2) return 0;

  const name = normalizeForMatch(unit.name);
  const crumb = normalizeForMatch(unit.breadcrumb);
  const crumbParts = unit.breadcrumb.split(' · ').map((p) => normalizeForMatch(p));
  let score = 0;

  if (name === qn) score = Math.max(score, 100);
  else if (name.startsWith(qn)) score = Math.max(score, 85);
  else if (name.includes(qn)) score = Math.max(score, 70);
  else if (crumb.includes(qn)) score = Math.max(score, 55);

  const qTokens = qn.split(/\s+/).filter((t) => t.length >= 2 && !LOCATION_STOP_WORDS.has(t));
  for (const token of qTokens) {
    if (name === token) score = Math.max(score, 90);
    else if (name.startsWith(token)) score = Math.max(score, 75);
    else if (name.includes(token)) score = Math.max(score, 60);
    else if (crumbParts.some((p) => p === token || p.includes(token))) score = Math.max(score, 45);
    else {
      for (const part of name.split(/\s+/)) {
        if (part.length >= 4 && fuzzyWordMatch(part, token)) score = Math.max(score, 50);
      }
      for (const part of crumbParts) {
        if (part.length >= 4 && fuzzyWordMatch(part, token)) score = Math.max(score, 35);
      }
    }
  }

  return score;
}

async function loadIntakeUnitResults(
  tenantId: string,
  hierarchy: Cd02Hierarchy,
  baseWhere: ReturnType<typeof and>,
  cap: number,
): Promise<IntakeUnitSearchResult[]> {
  const rows = await db
    .select({
      id: schema.unit.id,
      levelCode: schema.unit.levelCode,
      parentId: schema.unit.parentId,
      name: schema.unit.name,
    })
    .from(schema.unit)
    .where(baseWhere)
    .orderBy(asc(schema.unit.name))
    .limit(cap);

  if (!rows.length) return [];
  const byId = await loadAncestorMap(tenantId, rows);
  return toResults(rows, hierarchy, byId);
}

function rankUnitsByQuery(units: IntakeUnitSearchResult[], query: string, limit: number): IntakeUnitSearchResult[] {
  const queries = parseLocationQuery(query);
  const seen = new Map<string, IntakeUnitSearchResult & { score: number }>();

  for (const q of queries.length ? queries : [query]) {
    for (const unit of units) {
      const score = scoreUnitAgainstQuery(unit, q);
      if (score <= 0) continue;
      const prev = seen.get(unit.id);
      if (!prev || score > prev.score) seen.set(unit.id, { ...unit, score });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score: _s, ...u }) => u);
}

/** Find intake settlements whose names appear anywhere in free text (grievance narrative). */
export async function findUnitsMentionedInText(
  tenantId: string,
  text: string,
  limit = 8,
): Promise<IntakeUnitSearchResult[]> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return [];

  const hierarchy = await getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy');
  if (!hierarchy) return [];

  const levelCodes = await intakeUnitLevelCodes(tenantId, hierarchy);
  if (!levelCodes.length) return [];

  const levelFilter = sql`lower(${schema.unit.levelCode}) in (${sql.join(
    levelCodes.map((c) => sql`${c}`),
    sql`, `,
  )})`;
  const baseWhere = and(
    eq(schema.unit.tenantId, tenantId),
    eq(schema.unit.active, true),
    levelFilter,
  );

  const units = await loadIntakeUnitResults(tenantId, hierarchy, baseWhere, 500);
  const haystack = normalizeForMatch(trimmed);
  const hayTokens = haystack.split(/\s+/).filter((t) => t.length >= 3);

  const scored: { unit: IntakeUnitSearchResult; score: number }[] = [];
  for (const unit of units) {
    const name = normalizeForMatch(unit.name);
    let score = 0;

    if (haystack.includes(name) && name.length >= 3) score = 100;
    else {
      for (const word of name.split(/\s+/).filter((w) => w.length >= 4)) {
        if (haystack.includes(word)) score = Math.max(score, 70);
        else {
          for (const hay of hayTokens) {
            if (fuzzyWordMatch(hay, word)) score = Math.max(score, 55);
          }
        }
      }
    }

    for (const part of unit.breadcrumb.split(' · ')) {
      const pn = normalizeForMatch(part);
      if (pn.length >= 4 && haystack.includes(pn)) score = Math.max(score, 40);
      else if (pn.length >= 5) {
        for (const hay of hayTokens) {
          if (fuzzyWordMatch(hay, pn)) score = Math.max(score, 30);
        }
      }
    }

    if (score > 0) scored.push({ unit, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.unit.name.localeCompare(b.unit.name))
    .slice(0, limit)
    .map((x) => x.unit);
}

export type IntakeUnitResolveResult =
  | { status: 'resolved'; unit: IntakeUnitSearchResult }
  | { status: 'ambiguous'; options: IntakeUnitSearchResult[]; query: string }
  | { status: 'not_found'; query: string; suggestions: IntakeUnitSearchResult[] };

export async function resolveIntakeUnitQuery(
  tenantId: string,
  rawQuery: string,
): Promise<IntakeUnitResolveResult> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) {
    const suggestions = await searchIntakeUnits(tenantId, { limit: 8 });
    return { status: 'not_found', query: trimmed, suggestions };
  }

  const ranked = await searchIntakeUnits(tenantId, { q: trimmed, limit: 8 });
  if (ranked.length === 1) {
    return { status: 'resolved', unit: ranked[0]! };
  }
  if (ranked.length > 1) {
    const bestScore = scoreUnitAgainstQuery(ranked[0]!, trimmed);
    const secondScore = scoreUnitAgainstQuery(ranked[1]!, trimmed);
    if (bestScore >= 75 && bestScore - secondScore >= 15) {
      return { status: 'resolved', unit: ranked[0]! };
    }
    return { status: 'ambiguous', options: ranked.slice(0, 5), query: trimmed };
  }

  const suggestions = await searchIntakeUnits(tenantId, { limit: 8 });
  return { status: 'not_found', query: trimmed, suggestions };
}

/** Resolve settlement from full grievance content + explicit hints. */
export async function resolveIntakeUnitFromContent(
  tenantId: string,
  narrative: string,
  hints: string[],
): Promise<IntakeUnitResolveResult | null> {
  const mentioned = await findUnitsMentionedInText(tenantId, narrative, 8);
  if (mentioned.length === 1) {
    return { status: 'resolved', unit: mentioned[0]! };
  }
  if (mentioned.length > 1) {
    const best = mentioned[0]!;
    const second = mentioned[1];
    const bestScore = scoreUnitAgainstQuery(best, narrative);
    const secondScore = second ? scoreUnitAgainstQuery(second, narrative) : 0;
    if (bestScore >= 70 && bestScore - secondScore >= 20) {
      return { status: 'resolved', unit: best };
    }
    return { status: 'ambiguous', options: mentioned.slice(0, 5), query: best.name };
  }

  let last: IntakeUnitResolveResult | null = null;
  for (const hint of hints) {
    const result = await resolveIntakeUnitQuery(tenantId, hint);
    last = result;
    if (result.status === 'resolved') return result;
  }
  return last;
}
