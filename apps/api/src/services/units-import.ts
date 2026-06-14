import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { HierarchyLevel } from '@egrm/config-schemas';
import type { Cd02Hierarchy } from '../types.js';
import { isKisipHierarchy, kisipBundledTemplatePath } from '../data/kisip-units-template.js';
import { db, schema } from '../db/client.js';
import { writeAudit } from './audit.js';

type UnitRow = typeof schema.unit.$inferSelect;

export interface UnitImportRow {
  /** Level names top → bottom (aligned with hierarchy). */
  names: string[];
  code: string;
  active: boolean;
  sheetRow: number;
  /** Source worksheet (for error messages). */
  sheetName?: string;
}

export interface UnitImportRowError {
  row: number;
  message: string;
}

export interface UnitImportResult {
  created: number;
  skipped: number;
  errors: UnitImportRowError[];
}

const CODE_COL = 'unit_code';
const ACTIVE_COL = 'active';
const LEGACY_UNITS_SHEET = 'Units';
const IMPORT_BATCH_SIZE = 400;

/** CD-02 stores levels lowest-first; templates use top-first (National → … → Settlement). */
export function levelsTopFirst(hierarchy: Cd02Hierarchy): HierarchyLevel[] {
  return [...hierarchy.levels].reverse();
}

export function levelTopIndex(hierarchy: Cd02Hierarchy, levelCode: string): number {
  const needle = levelCode.toLowerCase();
  return levelsTopFirst(hierarchy).findIndex((l) => l.code.toLowerCase() === needle);
}

export function sheetNameForLevel(label: string, used: Set<string>): string {
  let base = label
    .replace(/[\\/*?[\]:]/g, '')
    .trim()
    .slice(0, 31);
  if (!base) base = 'Level';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n++;
  }
  used.add(name.toLowerCase());
  return name;
}

function slugCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'UNIT';
}

function parseActive(value: unknown): boolean | null {
  if (value == null || value === '') return true;
  const s = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'active'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(s)) return false;
  return null;
}

function headerKey(label: string): string {
  return label.trim().toLowerCase();
}

function deepestFilledIndex(names: string[]): number {
  for (let i = names.length - 1; i >= 0; i--) {
    if (names[i]) return i;
  }
  return -1;
}

function pathKey(names: string[], throughIndex: number): string {
  return names
    .slice(0, throughIndex + 1)
    .map((n) => n.trim().toLowerCase())
    .join('|');
}

/** Headers for a level sheet: ancestors + this level + unit_code + active. */
export function headersForLevelSheet(hierarchy: Cd02Hierarchy, levelIndex: number): string[] {
  const levels = levelsTopFirst(hierarchy);
  return [...levels.slice(0, levelIndex + 1).map((l) => l.label), CODE_COL, ACTIVE_COL];
}

/** Flatten the unit tree into import rows (one row per leaf path) — legacy single-sheet layout. */
export function flattenUnitsToRows(units: UnitRow[], hierarchy: Cd02Hierarchy): UnitImportRow[] {
  const levels = levelsTopFirst(hierarchy);
  const byParent = new Map<string | null, UnitRow[]>();
  for (const u of units) {
    const key = u.parentId;
    const list = byParent.get(key) ?? [];
    list.push(u);
    byParent.set(key, list);
  }

  const rows: UnitImportRow[] = [];

  const walk = (unit: UnitRow, ancestorNames: string[]) => {
    const children = byParent.get(unit.id) ?? [];
    const path = [...ancestorNames, unit.name];
    if (children.length === 0) {
      const names = levels.map((_, i) => path[i] ?? '');
      rows.push({ names, code: unit.code, active: unit.active, sheetRow: 0 });
      return;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      walk(child, path);
    }
  };

  const roots = (byParent.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  for (const root of roots) walk(root, []);

  return rows;
}

/** One row per unit, grouped by hierarchy level (for per-level sheets). */
export function unitsGroupedByLevel(
  units: UnitRow[],
  hierarchy: Cd02Hierarchy,
): Map<number, UnitImportRow[]> {
  const levels = levelsTopFirst(hierarchy);
  const byParent = new Map<string | null, UnitRow[]>();
  for (const u of units) {
    const list = byParent.get(u.parentId) ?? [];
    list.push(u);
    byParent.set(u.parentId, list);
  }

  const grouped = new Map<number, Map<string, UnitImportRow>>();
  for (let i = 0; i < levels.length; i++) grouped.set(i, new Map());

  const walk = (unit: UnitRow, ancestorNames: string[]) => {
    const path = [...ancestorNames, unit.name];
    const idx = levelTopIndex(hierarchy, unit.levelCode);
    if (idx >= 0) {
      const names = levels.map((_, i) => path[i] ?? '');
      const key = pathKey(names, idx);
      const bucket = grouped.get(idx)!;
      if (!bucket.has(key)) {
        bucket.set(key, { names, code: unit.code, active: unit.active, sheetRow: 0 });
      }
    }
    const children = (byParent.get(unit.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) walk(child, path);
  };

  for (const root of (byParent.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
    walk(root, []);
  }

  const out = new Map<number, UnitImportRow[]>();
  for (const [idx, bucket] of grouped) {
    out.set(
      idx,
      [...bucket.values()].sort((a, b) => {
        const da = deepestFilledIndex(a.names);
        const db = deepestFilledIndex(b.names);
        for (let i = 0; i <= Math.max(da, db); i++) {
          const cmp = (a.names[i] ?? '').localeCompare(b.names[i] ?? '');
          if (cmp !== 0) return cmp;
        }
        return a.code.localeCompare(b.code);
      }),
    );
  }
  return out;
}

/** Sample rows per level sheet when the tenant has no units yet. */
function exampleRowsByLevel(hierarchy: Cd02Hierarchy): Map<number, UnitImportRow[]> {
  const levels = levelsTopFirst(hierarchy);
  const leafPaths: UnitImportRow[] = [];

  if (levels.length >= 5) {
    leafPaths.push(
      {
        names: ['Kenya', 'Nairobi', 'Dagoretti North', 'Kilimani', 'Mukuru kwa Njenga'],
        code: 'SET-001',
        active: true,
        sheetRow: 0,
      },
      {
        names: ['Kenya', 'Nairobi', 'Kibera', 'Soweto East', 'Kibera Soweto East'],
        code: 'SET-002',
        active: true,
        sheetRow: 0,
      },
      {
        names: ['Kenya', 'Mombasa', 'Likoni', 'Likoni West', 'Likoni'],
        code: 'SET-003',
        active: true,
        sheetRow: 0,
      },
    );
  } else if (levels.length >= 3) {
    leafPaths.push(
      { names: ['Kenya', 'Nairobi', 'Mukuru kwa Njenga'], code: 'SET-001', active: true, sheetRow: 0 },
      { names: ['Kenya', 'Mombasa', 'Likoni'], code: 'SET-002', active: true, sheetRow: 0 },
    );
  } else if (levels.length === 2) {
    leafPaths.push({ names: ['National', 'Region A'], code: 'REG-A', active: true, sheetRow: 0 });
  } else if (levels.length === 1) {
    leafPaths.push({ names: ['National'], code: 'NAT-001', active: true, sheetRow: 0 });
  }

  // Pad or trim paths to match configured depth.
  for (const row of leafPaths) {
    const names = levels.map((_, i) => row.names[i] ?? '');
    row.names = names;
  }

  return deriveLevelSheetsFromPaths(leafPaths, hierarchy);
}

/** Expand full paths into one row per level (deduped by path prefix). */
export function deriveLevelSheetsFromPaths(
  paths: UnitImportRow[],
  hierarchy: Cd02Hierarchy,
): Map<number, UnitImportRow[]> {
  const levels = levelsTopFirst(hierarchy);
  const grouped = new Map<number, Map<string, UnitImportRow>>();
  for (let i = 0; i < levels.length; i++) grouped.set(i, new Map());

  for (const path of paths) {
    const deepest = deepestFilledIndex(path.names);
    if (deepest < 0) continue;
    for (let i = 0; i <= deepest; i++) {
      const names = levels.map((_, j) => (j <= i ? (path.names[j] ?? '').trim() : ''));
      if (!names[i]) continue;
      const key = pathKey(names, i);
      const bucket = grouped.get(i)!;
      if (!bucket.has(key)) {
        const code = i === deepest ? path.code : slugCode(names[i]!);
        bucket.set(key, {
          names,
          code,
          active: i === deepest ? path.active : true,
          sheetRow: 0,
        });
      }
    }
  }

  const out = new Map<number, UnitImportRow[]>();
  for (const [idx, bucket] of grouped) {
    out.set(idx, [...bucket.values()].sort((a, b) => pathKey(a.names, deepestFilledIndex(a.names)).localeCompare(pathKey(b.names, deepestFilledIndex(b.names)))));
  }
  return out;
}

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
}

async function buildMultiSheetWorkbook(
  hierarchy: Cd02Hierarchy,
  rowsByLevel: Map<number, UnitImportRow[]>,
  title: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eGRM';
  wb.created = new Date();

  const levels = levelsTopFirst(hierarchy);
  const chain = levels.map((l) => l.label).join(' → ');
  const usedNames = new Set<string>();

  const instructions = wb.addWorksheet('Instructions');
  instructions.columns = [{ width: 95 }];
  instructions.addRow([title]);
  instructions.addRow([]);
  instructions.addRow(['Configured hierarchy (top → bottom):', chain]);
  instructions.addRow([]);
  instructions.addRow(['Workbook layout:']);
  instructions.addRow(['• One worksheet per hierarchy level (names match CD-02 level labels).']);
  instructions.addRow(['• Fill each sheet with units at that level; parent columns must match rows on higher-level sheets.']);
  instructions.addRow(['• unit_code is required on every row (unique per tenant).']);
  instructions.addRow(['• active: yes / no (defaults to yes).']);
  instructions.addRow(['• Existing units with the same parent + name are reused; only missing units are created.']);
  instructions.addRow(['• You may import only the sheets you need, or use the legacy single "Units" sheet with all columns.']);
  instructions.getRow(1).font = { bold: true, size: 14 };

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx]!;
    const sheetTitle = sheetNameForLevel(level.label, usedNames);
    const sheet = wb.addWorksheet(sheetTitle);
    const headers = headersForLevelSheet(hierarchy, levelIdx);
    sheet.addRow(headers);
    styleHeaderRow(sheet);

    const rows = rowsByLevel.get(levelIdx) ?? [];
    for (const row of rows) {
      const values = [
        ...row.names.slice(0, levelIdx + 1),
        row.code,
        row.active ? 'yes' : 'no',
      ];
      sheet.addRow(values);
    }

    headers.forEach((_, i) => {
      sheet.getColumn(i + 1).width = i <= levelIdx ? 22 : 14;
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Downloadable template — per-level sheets from CD-02; KISIP uses specs/adminunits bundle when empty. */
export async function buildUnitsImportTemplate(
  hierarchy: Cd02Hierarchy,
  units: UnitRow[],
  tenantCode?: string,
): Promise<Buffer> {
  if (units.length === 0 && tenantCode?.toLowerCase() === 'kisip' && isKisipHierarchy(hierarchy)) {
    const bundled = kisipBundledTemplatePath();
    if (bundled) {
      return await fs.readFile(bundled);
    }
  }

  const rowsByLevel =
    units.length > 0 ? unitsGroupedByLevel(units, hierarchy) : exampleRowsByLevel(hierarchy);
  return buildMultiSheetWorkbook(
    hierarchy,
    rowsByLevel,
    units.length > 0 ? 'Jurisdiction units export / import template' : 'Jurisdiction units import template',
  );
}

/** Export current unit tree — one sheet per configured level. */
export async function buildUnitsExport(hierarchy: Cd02Hierarchy, units: UnitRow[]): Promise<Buffer> {
  const rowsByLevel = unitsGroupedByLevel(units, hierarchy);
  return buildMultiSheetWorkbook(hierarchy, rowsByLevel, 'Jurisdiction units export');
}

function findWorksheetForLevel(wb: ExcelJS.Workbook, level: HierarchyLevel): ExcelJS.Worksheet | undefined {
  const needle = headerKey(level.label);
  for (const sheet of wb.worksheets) {
    if (headerKey(sheet.name) === needle) return sheet;
    if (headerKey(sheet.name).startsWith(needle)) return sheet;
  }
  return undefined;
}

function parseLegacyUnitsSheet(
  sheet: ExcelJS.Worksheet,
  hierarchy: Cd02Hierarchy,
): { rows: UnitImportRow[]; errors: UnitImportRowError[] } {
  const levels = levelsTopFirst(hierarchy);
  const headerRow = sheet.getRow(1);
  const headerCells: string[] = [];
  headerRow.eachCell((cell, col) => {
    headerCells[col - 1] = String(cell.value ?? '').trim();
  });

  const levelCols: number[] = [];
  for (const level of levels) {
    const idx = headerCells.findIndex((h) => headerKey(h) === headerKey(level.label));
    if (idx < 0) {
      return { rows: [], errors: [{ row: 1, message: `Missing column for level "${level.label}"` }] };
    }
    levelCols.push(idx);
  }

  const codeCol = headerCells.findIndex((h) => headerKey(h) === CODE_COL);
  const activeCol = headerCells.findIndex((h) => headerKey(h) === ACTIVE_COL);
  if (codeCol < 0) {
    return { rows: [], errors: [{ row: 1, message: `Missing required column "${CODE_COL}"` }] };
  }

  const rows: UnitImportRow[] = [];
  const errors: UnitImportRowError[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const names = levelCols.map((col) => String(row.getCell(col + 1).value ?? '').trim());
    const parsed = parseImportRow(names, levels, row, r, codeCol, activeCol, sheet.name);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.row) rows.push(parsed.row);
  }

  return { rows, errors };
}

function parseLevelSheet(
  sheet: ExcelJS.Worksheet,
  hierarchy: Cd02Hierarchy,
  levelIndex: number,
): { rows: UnitImportRow[]; errors: UnitImportRowError[] } {
  const levels = levelsTopFirst(hierarchy);
  const level = levels[levelIndex]!;

  const headerRow = sheet.getRow(1);
  const headerCells: string[] = [];
  headerRow.eachCell((cell, col) => {
    headerCells[col - 1] = String(cell.value ?? '').trim();
  });

  const levelCols: number[] = [];
  for (let i = 0; i <= levelIndex; i++) {
    const idx = headerCells.findIndex((h) => headerKey(h) === headerKey(levels[i]!.label));
    if (idx < 0) {
      return {
        rows: [],
        errors: [{ row: 1, message: `Sheet "${sheet.name}": missing column "${levels[i]!.label}"` }],
      };
    }
    levelCols.push(idx);
  }

  const codeCol = headerCells.findIndex((h) => headerKey(h) === CODE_COL);
  const activeCol = headerCells.findIndex((h) => headerKey(h) === ACTIVE_COL);
  if (codeCol < 0) {
    return { rows: [], errors: [{ row: 1, message: `Sheet "${sheet.name}": missing "${CODE_COL}"` }] };
  }

  const rows: UnitImportRow[] = [];
  const errors: UnitImportRowError[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const partial = levelCols.map((col) => String(row.getCell(col + 1).value ?? '').trim());
    const names = levels.map((_, i) => (i <= levelIndex ? partial[i] ?? '' : ''));
    const parsed = parseImportRow(names, levels, row, r, codeCol, activeCol, sheet.name, levelIndex);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.row) rows.push(parsed.row);
  }

  return { rows, errors };
}

function parseImportRow(
  names: string[],
  levels: HierarchyLevel[],
  row: ExcelJS.Row,
  rowNumber: number,
  codeCol: number,
  activeCol: number,
  sheetName: string,
  fixedDeepest?: number,
): { row?: UnitImportRow; error?: UnitImportRowError } {
  const hasAny = names.some((n) => n.length > 0);
  if (!hasAny) return {};

  const deepest = fixedDeepest ?? deepestFilledIndex(names);
  if (deepest < 0) return {};

  for (let i = 0; i < deepest; i++) {
    if (!names[i]) {
      return {
        error: {
          row: rowNumber,
          message: `Sheet "${sheetName}" row ${rowNumber}: "${levels[i]!.label}" is required before "${levels[deepest]!.label}"`,
        },
      };
    }
  }

  const code = String(row.getCell(codeCol + 1).value ?? '').trim();
  if (!code) {
    return { error: { row: rowNumber, message: `Sheet "${sheetName}" row ${rowNumber}: unit_code is required` } };
  }

  let active = true;
  if (activeCol >= 0) {
    const parsed = parseActive(row.getCell(activeCol + 1).value);
    if (parsed === null) {
      return { error: { row: rowNumber, message: `Sheet "${sheetName}" row ${rowNumber}: active must be yes/no` } };
    }
    active = parsed;
  }

  return {
    row: { names, code, active, sheetRow: rowNumber, sheetName },
  };
}

export async function parseUnitsWorkbook(
  buffer: Buffer,
  hierarchy: Cd02Hierarchy,
): Promise<{ rows: UnitImportRow[]; errors: UnitImportRowError[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  if (!wb.worksheets.length) {
    return { rows: [], errors: [{ row: 0, message: 'Workbook has no worksheets' }] };
  }

  const levels = levelsTopFirst(hierarchy);
  const legacySheet = wb.getWorksheet(LEGACY_UNITS_SHEET);
  if (legacySheet) {
    return parseLegacyUnitsSheet(legacySheet, hierarchy);
  }

  const rows: UnitImportRow[] = [];
  const errors: UnitImportRowError[] = [];
  const seen = new Set<string>();

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx]!;
    const sheet = findWorksheetForLevel(wb, level);
    if (!sheet) continue;

    const { rows: sheetRows, errors: sheetErrors } = parseLevelSheet(sheet, hierarchy, levelIdx);
    errors.push(...sheetErrors);
    for (const r of sheetRows) {
      const key = `${levelIdx}::${pathKey(r.names, deepestFilledIndex(r.names))}::${r.code.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    const names = wb.worksheets.map((s) => s.name).join(', ');
    return {
      rows: [],
      errors: [{
        row: 0,
        message: `No level sheets matched CD-02 labels (found: ${names}). Expected worksheets named like: ${levels.map((l) => l.label).join(', ')}`,
      }],
    };
  }

  return { rows, errors };
}

function parentNameKey(parentId: string | null, name: string): string {
  return `${parentId ?? 'root'}::${normalizeUnitName(name)}`;
}

function normalizeUnitName(name: string): string {
  return name.trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
}

/** Stable code for auto-created ancestors (path prefix avoids "Mjini" collisions). */
function materializedCode(names: string[], throughIndex: number): string {
  return slugCode(names.slice(0, throughIndex + 1).filter(Boolean).join('-'));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ImportMaps = {
  all: UnitRow[];
  byCode: Map<string, UnitRow>;
  byParentName: Map<string, UnitRow>;
  pendingCodes: Set<string>;
  pendingByParentKey: Map<string, PendingInsert>;
  materialized: number;
};

function registerUnit(maps: ImportMaps, unit: UnitRow, codeKey: string, parentKey: string) {
  maps.byCode.set(codeKey, unit);
  maps.byParentName.set(parentKey, unit);
  maps.all.push(unit);
}

/**
 * Resolve parent for depth D, creating any missing ancestors along the path
 * (same behaviour as legacy path-walk import — required for settlement-only sheets).
 */
async function ensureParentPath(
  names: string[],
  targetDepth: number,
  tenantId: string,
  levels: HierarchyLevel[],
  tx: { insert: typeof db.insert; update: typeof db.update },
  maps: ImportMaps,
): Promise<string | null | undefined> {
  if (targetDepth === 0) return null;

  let parentId: string | null = null;
  for (let i = 0; i < targetDepth; i++) {
    const name = names[i]?.trim();
    if (!name) return undefined;

    const parentKey = parentNameKey(parentId, name);
    const pending = maps.pendingByParentKey.get(parentKey);
    if (pending?.stagedId) {
      parentId = pending.stagedId;
      continue;
    }

    let unit = maps.byParentName.get(parentKey);
    if (!unit) {
      if (parentId === null && i !== 0) return undefined;

      if (parentId === null) {
        const existingRoot = maps.all.find((u) => u.parentId === null);
        if (existingRoot && normalizeUnitName(existingRoot.name) !== normalizeUnitName(name)) {
          return undefined;
        }
      }

      const level = levels[i]!;
      const code = materializedCode(names, i);
      const codeKey = code.toLowerCase();
      if (maps.byCode.has(codeKey) || maps.pendingCodes.has(codeKey)) {
        const byCode = maps.byCode.get(codeKey);
        if (byCode && normalizeUnitName(byCode.name) === normalizeUnitName(name)) {
          unit = byCode;
          maps.byParentName.set(parentKey, unit);
          parentId = unit.id;
          continue;
        }
        return undefined;
      }

      const [inserted] = await tx
        .insert(schema.unit)
        .values({
          tenantId,
          levelCode: level.code,
          parentId,
          name,
          code,
          active: true,
        })
        .returning();

      unit = inserted as UnitRow;
      registerUnit(maps, unit, codeKey, parentKey);
      maps.pendingCodes.add(codeKey);
      maps.materialized++;
    }

    parentId = unit.id;
  }

  return parentId;
}

type PendingInsert = {
  tenantId: string;
  levelCode: string;
  parentId: string | null;
  name: string;
  code: string;
  active: boolean;
  row: UnitImportRow;
  codeKey: string;
  parentKey: string;
  /** Set after batch flush for rows still awaiting DB ids in the same transaction. */
  stagedId?: string;
};

/** Import parsed rows with batched inserts per hierarchy level (fast for large workbooks). */
export async function importUnitsFromRows(
  tenantId: string,
  hierarchy: Cd02Hierarchy,
  rows: UnitImportRow[],
  actorId: string,
): Promise<UnitImportResult> {
  const levels = levelsTopFirst(hierarchy);
  const all = await db.select().from(schema.unit).where(eq(schema.unit.tenantId, tenantId));
  const byCode = new Map(all.map((u) => [u.code.toLowerCase(), u]));
  const byParentName = new Map(all.map((u) => [parentNameKey(u.parentId, u.name), u]));

  let created = 0;
  let skipped = 0;
  const errors: UnitImportRowError[] = [];
  const pendingCodes = new Set<string>();

  const maps: ImportMaps = {
    all,
    byCode,
    byParentName,
    pendingCodes,
    pendingByParentKey: new Map(),
    materialized: 0,
  };

  const byDepth = new Map<number, UnitImportRow[]>();
  for (const row of rows) {
    const depth = deepestFilledIndex(row.names);
    if (depth < 0) continue;
    const list = byDepth.get(depth) ?? [];
    list.push(row);
    byDepth.set(depth, list);
  }

  await db.transaction(async (tx) => {
    for (let depth = 0; depth < levels.length; depth++) {
      const depthRows = byDepth.get(depth) ?? [];
      if (!depthRows.length) continue;

      const level = levels[depth]!;
      const pending: PendingInsert[] = [];

      for (const row of depthRows) {
        const deepest = deepestFilledIndex(row.names);
        if (deepest !== depth) continue;

        const name = row.names[depth]!.trim();
        if (!name) {
          errors.push({ row: row.sheetRow, message: `Missing name at level "${level.label}"` });
          continue;
        }

        const parentId = await ensureParentPath(row.names, depth, tenantId, levels, tx, maps);
        if (parentId === undefined) {
          errors.push({
            row: row.sheetRow,
            message: `Could not resolve parent path for "${name}" — check county / sub-county / ward names`,
          });
          continue;
        }

        const parentKey = parentNameKey(parentId, name);
        const existingUnit = maps.byParentName.get(parentKey);
        if (existingUnit) {
          if (existingUnit.code.toLowerCase() !== row.code.toLowerCase()) {
            errors.push({
              row: row.sheetRow,
              message: `"${name}" already exists with code ${existingUnit.code}, not ${row.code}`,
            });
            continue;
          }
          if (existingUnit.active !== row.active) {
            await tx.update(schema.unit).set({ active: row.active }).where(eq(schema.unit.id, existingUnit.id));
            const updated = { ...existingUnit, active: row.active };
            maps.byParentName.set(parentKey, updated);
            maps.byCode.set(existingUnit.code.toLowerCase(), updated);
          }
          skipped++;
          continue;
        }
        if (maps.pendingByParentKey.has(parentKey)) {
          skipped++;
          continue;
        }

        const code = row.code.trim();
        const codeKey = code.toLowerCase();
        if (maps.byCode.has(codeKey) || maps.pendingCodes.has(codeKey)) {
          errors.push({ row: row.sheetRow, message: `Duplicate unit code "${code}"` });
          continue;
        }

        if (parentId === null) {
          const existingRoot = maps.all.find((u) => u.parentId === null);
          if (existingRoot && normalizeUnitName(existingRoot.name) !== normalizeUnitName(name)) {
            errors.push({
              row: row.sheetRow,
              message: `Only one top-level unit is allowed (existing: "${existingRoot.name}")`,
            });
            continue;
          }
        }

        const item: PendingInsert = {
          tenantId,
          levelCode: level.code,
          parentId,
          name,
          code,
          active: row.active,
          row,
          codeKey,
          parentKey,
        };
        pending.push(item);
        maps.pendingByParentKey.set(parentKey, item);
        maps.pendingCodes.add(codeKey);
      }

      for (const batch of chunk(pending, IMPORT_BATCH_SIZE)) {
        try {
          const inserted = await tx
            .insert(schema.unit)
            .values(
              batch.map((p) => ({
                tenantId: p.tenantId,
                levelCode: p.levelCode,
                parentId: p.parentId,
                name: p.name,
                code: p.code,
                active: p.active,
              })),
            )
            .returning();

          for (let i = 0; i < inserted.length; i++) {
            const unit = inserted[i]! as UnitRow;
            const meta = batch[i]!;
            meta.stagedId = unit.id;
            registerUnit(maps, unit, meta.codeKey, meta.parentKey);
            maps.pendingByParentKey.delete(meta.parentKey);
            created++;
          }
        } catch (e: unknown) {
          const err = e as { code?: string; cause?: { code?: string } };
          for (const p of batch) {
            maps.pendingByParentKey.delete(p.parentKey);
            maps.pendingCodes.delete(p.codeKey);
            if (err.code === '23505' || err.cause?.code === '23505') {
              errors.push({ row: p.row.sheetRow, message: `Duplicate unit code "${p.code}"` });
            } else {
              errors.push({
                row: p.row.sheetRow,
                message: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }
    }
  });

  created += maps.materialized;

  if (created > 0) {
    await writeAudit({
      tenantId,
      actorId,
      action: 'unit.imported',
      entity: 'unit',
      entityId: tenantId,
      data: { created, skipped, row_count: rows.length, errors: errors.length },
    });
  }

  return { created, skipped, errors };
}
