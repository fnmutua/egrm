#!/usr/bin/env node
/**
 * Build the KISIP jurisdiction import workbook from specs/adminunits source files.
 * Output matches the runtime per-level sheet layout (Instructions + one sheet per CD-02 level).
 *
 * Sources:
 *   county.xlsx, subcounty.xlsx, ward.xlsx, settlement*.xlsx
 *
 * Usage: node scripts/build-kisip-units-template.mjs
 * Output:
 *   specs/adminunits/kisip-units-import-template.xlsx
 *   apps/api/data/kisip-units-import-template.xlsx
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'specs', 'adminunits');
const OUT_SPECS = path.join(SOURCE_DIR, 'kisip-units-import-template.xlsx');
const OUT_API = path.join(ROOT, 'apps', 'api', 'data', 'kisip-units-import-template.xlsx');

const NATIONAL_NAME = 'Kenya';
const NATIONAL_CODE = 'KE';
const DEPTH = 5;

const LEVEL_LABELS = ['National', 'County', 'Sub-county', 'Ward', 'Settlement'];
const CODE_COL = 'unit_code';
const ACTIVE_COL = 'active';

function cellText(cell) {
  if (cell == null || cell === '') return '';
  return String(cell).trim();
}

function slugCode(name) {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'UNIT';
}

function sheetNameForLevel(label, used) {
  let base = label.replace(/[\\/*?[\]:]/g, '').trim().slice(0, 31) || 'Level';
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

function headersForLevel(levelIndex) {
  return [...LEVEL_LABELS.slice(0, levelIndex + 1), CODE_COL, ACTIVE_COL];
}

function emptyNames() {
  return Array(DEPTH).fill('');
}

function findSourceFile(prefix) {
  const match = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && f.toLowerCase().startsWith(prefix))
    .sort();
  if (!match.length) throw new Error(`No ${prefix}*.xlsx in specs/adminunits`);
  return path.join(SOURCE_DIR, match[0]);
}

async function readSheetRows(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];
  const headers = {};
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = cellText(cell.value);
  });
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record = {};
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (key) record[key] = cell.value;
    });
    if (Object.keys(record).length > 0) rows.push(record);
  }
  return rows;
}

function parseActive(value) {
  if (value == null || value === '') return true;
  const s = cellText(value).toLowerCase();
  if (['true', 'yes', 'y', '1', 'active', 'approved'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'inactive'].includes(s)) return false;
  return true;
}

function settlementCode(id, rawCode) {
  const code = cellText(rawCode);
  if (code) return code.slice(0, 64);
  return `SET-${id}`;
}

function pickField(row, ...keys) {
  for (const key of keys) {
    const v = cellText(row[key]);
    if (v) return v;
  }
  return '';
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    for (let i = 0; i < DEPTH; i++) {
      const cmp = (a.names[i] ?? '').localeCompare(b.names[i] ?? '');
      if (cmp !== 0) return cmp;
    }
    return a.code.localeCompare(b.code);
  });
}

function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
}

async function buildRowsByLevel() {
  const countyPath = path.join(SOURCE_DIR, 'county.xlsx');
  const subcountyPath = path.join(SOURCE_DIR, 'subcounty.xlsx');
  const wardPath = path.join(SOURCE_DIR, 'ward.xlsx');
  const settlementPath = findSourceFile('settlement');

  const [counties, subcounties, wards, settlements] = await Promise.all([
    readSheetRows(countyPath),
    readSheetRows(subcountyPath),
    readSheetRows(wardPath),
    readSheetRows(settlementPath),
  ]);

  const countiesById = new Map();
  for (const c of counties) {
    const id = pickField(c, 'Id');
    if (!id) continue;
    countiesById.set(id, { name: pickField(c, 'Name'), code: pickField(c, 'Code') || slugCode(pickField(c, 'Name')) });
  }

  const subcountiesById = new Map();
  for (const sc of subcounties) {
    const id = pickField(sc, 'Id');
    if (!id) continue;
    subcountiesById.set(id, {
      name: pickField(sc, 'Name'),
      code: pickField(sc, 'Code') || slugCode(pickField(sc, 'Name')),
      countyId: pickField(sc, 'CountyId'),
    });
  }

  const rowsByLevel = new Map();
  for (let i = 0; i < DEPTH; i++) rowsByLevel.set(i, []);
  const warnings = [];

  // National
  {
    const names = emptyNames();
    names[0] = NATIONAL_NAME;
    rowsByLevel.get(0).push({ names, code: NATIONAL_CODE, active: true });
  }

  // Counties
  for (const c of counties) {
    const name = pickField(c, 'Name');
    if (!name) continue;
    const names = emptyNames();
    names[0] = NATIONAL_NAME;
    names[1] = name;
    rowsByLevel.get(1).push({
      names,
      code: pickField(c, 'Code') || slugCode(name),
      active: true,
    });
  }

  // Sub-counties
  for (const sc of subcounties) {
    const name = pickField(sc, 'Name');
    const countyId = pickField(sc, 'CountyId');
    const county = countiesById.get(countyId);
    if (!name) continue;
    if (!county) {
      warnings.push(`Sub-county ${name}: unknown CountyId ${countyId}`);
      continue;
    }
    const names = emptyNames();
    names[0] = NATIONAL_NAME;
    names[1] = county.name;
    names[2] = name;
    rowsByLevel.get(2).push({
      names,
      code: pickField(sc, 'Code') || slugCode(name),
      active: true,
    });
  }

  // Wards
  for (const w of wards) {
    const name = pickField(w, 'Name');
    const countyId = pickField(w, 'CountyId');
    const subcountyId = pickField(w, 'SubcountyId');
    const county = countiesById.get(countyId);
    const subcounty = subcountiesById.get(subcountyId);
    if (!name) continue;
    if (!county || !subcounty) {
      warnings.push(`Ward ${name}: missing county/sub-county (CountyId=${countyId}, SubcountyId=${subcountyId})`);
      continue;
    }
    const names = emptyNames();
    names[0] = NATIONAL_NAME;
    names[1] = county.name;
    names[2] = subcounty.name;
    names[3] = name;
    rowsByLevel.get(3).push({
      names,
      code: pickField(w, 'Code') || slugCode(name),
      active: true,
    });
  }

  // Settlements (leaf — full path from settlement record)
  for (const s of settlements) {
    const id = pickField(s, 'Id');
    const name = pickField(s, 'Name');
    const county = pickField(s, 'CountyName');
    const subcounty = pickField(s, 'SubcountyName');
    const ward = pickField(s, 'WardName');
    if (!name) {
      warnings.push(`Settlement ${id || '?'}: missing Name`);
      continue;
    }
    if (!county || !subcounty || !ward) {
      warnings.push(`Settlement ${id} ${name}: missing CountyName/SubcountyName/WardName`);
      continue;
    }
    const names = emptyNames();
    names[0] = NATIONAL_NAME;
    names[1] = county;
    names[2] = subcounty;
    names[3] = ward;
    names[4] = name;
    rowsByLevel.get(4).push({
      names,
      code: settlementCode(id, s.Code),
      active: parseActive(s.Isactive ?? s.IsApproved ?? s.Isapproved),
    });
  }

  for (const [idx, rows] of rowsByLevel) {
    rowsByLevel.set(idx, sortRows(rows));
  }

  const stats = {
    national: rowsByLevel.get(0).length,
    counties: rowsByLevel.get(1).length,
    subcounties: rowsByLevel.get(2).length,
    wards: rowsByLevel.get(3).length,
    settlements: rowsByLevel.get(4).length,
  };

  return {
    rowsByLevel,
    stats,
    sources: {
      county: path.basename(countyPath),
      subcounty: path.basename(subcountyPath),
      ward: path.basename(wardPath),
      settlement: path.basename(settlementPath),
    },
    warnings,
  };
}

async function writeWorkbook(rowsByLevel, stats, sources, warnings) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eGRM';
  wb.created = new Date();

  const usedNames = new Set();
  const chain = LEVEL_LABELS.join(' → ');

  const instructions = wb.addWorksheet('Instructions');
  instructions.columns = [{ width: 95 }];
  instructions.addRow(['KISIP jurisdiction units — import template (from specs/adminunits)']);
  instructions.addRow([]);
  instructions.addRow(['Hierarchy (top → bottom):', chain]);
  instructions.addRow(['Sources:', `${sources.county}, ${sources.subcounty}, ${sources.ward}, ${sources.settlement}`]);
  instructions.addRow([
    'Rows per sheet:',
    `National ${stats.national}, Counties ${stats.counties}, Sub-counties ${stats.subcounties}, Wards ${stats.wards}, Settlements ${stats.settlements}`,
  ]);
  instructions.addRow([]);
  instructions.addRow(['Import via Admin → Jurisdiction units → Import Excel.']);
  instructions.addRow(['• One worksheet per hierarchy level; parent columns must match higher-level sheets.']);
  instructions.addRow(['• unit_code is required on every row (unique per tenant).']);
  instructions.addRow(['• National is always "Kenya"; missing parents are created on import.']);
  instructions.addRow(['• Existing paths (same parent + name) are reused; only new nodes are inserted.']);
  instructions.getRow(1).font = { bold: true, size: 14 };

  for (let levelIdx = 0; levelIdx < LEVEL_LABELS.length; levelIdx++) {
    const label = LEVEL_LABELS[levelIdx];
    const sheetTitle = sheetNameForLevel(label, usedNames);
    const sheet = wb.addWorksheet(sheetTitle);
    const headers = headersForLevel(levelIdx);
    sheet.addRow(headers);
    styleHeaderRow(sheet);

    for (const row of rowsByLevel.get(levelIdx) ?? []) {
      sheet.addRow([
        ...row.names.slice(0, levelIdx + 1),
        row.code,
        row.active ? 'yes' : 'no',
      ]);
    }

    headers.forEach((_, i) => {
      sheet.getColumn(i + 1).width = i <= levelIdx ? 22 : 14;
    });
  }

  fs.mkdirSync(path.dirname(OUT_API), { recursive: true });
  await wb.xlsx.writeFile(OUT_SPECS);
  await wb.xlsx.writeFile(OUT_API);
}

const { rowsByLevel, stats, sources, warnings } = await buildRowsByLevel();
await writeWorkbook(rowsByLevel, stats, sources, warnings);

if (warnings.length) {
  console.warn(`Warnings (${warnings.length}):`);
  for (const w of warnings.slice(0, 10)) console.warn(' ', w);
  if (warnings.length > 10) console.warn(`  … and ${warnings.length - 10} more`);
}

console.log('KISIP import workbook written:');
console.log(' ', OUT_SPECS);
console.log(' ', OUT_API);
console.log('Stats:', stats);
console.log('Sources:', sources);
