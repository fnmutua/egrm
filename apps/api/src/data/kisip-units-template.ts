import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Pre-built KISIP workbook from specs/adminunits (multi-sheet, per-level). */
export function kisipBundledTemplatePath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../data/kisip-units-import-template.xlsx'),
    path.resolve(__dirname, '../../../data/kisip-units-import-template.xlsx'),
    path.resolve(process.cwd(), 'apps/api/data/kisip-units-import-template.xlsx'),
    path.resolve(process.cwd(), 'specs/adminunits/kisip-units-import-template.xlsx'),
    path.resolve(process.cwd(), '../../specs/adminunits/kisip-units-import-template.xlsx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const KISIP_HIERARCHY_LABELS = ['National', 'County', 'Sub-county', 'Ward', 'Settlement'] as const;

const KISIP_LEVEL_CODES = new Set(['settlement', 'ward', 'subcounty', 'county', 'national']);

export function isKisipHierarchy(hierarchy: { levels: { code: string }[] }): boolean {
  const codes = hierarchy.levels.map((l) => l.code.toLowerCase());
  if (codes.length !== 5) return false;
  return codes.every((c) => KISIP_LEVEL_CODES.has(c));
}
