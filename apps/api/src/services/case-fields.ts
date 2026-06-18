import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd02Hierarchy, Cd03Taxonomy } from '@egrm/config-schemas';
import { intakeLevels as hierarchyIntakeLevels } from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { canAccessCase, type UserAccess } from './access.js';
import { writeAudit } from './audit.js';
import { coerceIntakeString, coerceIntakeStringArray, parseIntakeDate } from './intake-values.js';
import { intakeUnitLevelCodes } from './intake-units.js';

const EDITABLE_FIELDS = new Set([
  'summary',
  'description',
  'expected_outcome',
  'date_occurred',
  'categories',
  'priority',
  'sensitivity',
  'unit_id',
]);

export const patchCaseFieldsBody = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .refine((fields) => Object.keys(fields).length > 0, 'fields_required')
    .refine(
      (fields) => Object.keys(fields).every((key) => EDITABLE_FIELDS.has(key)),
      'invalid_field',
    ),
});

export type CaseFieldOptions = {
  categories: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  sensitivity: { value: string; label: string; restricted: boolean }[];
};

export async function getCaseFieldOptions(tenantId: string): Promise<CaseFieldOptions | null> {
  const taxonomy = await getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy');
  if (!taxonomy) return null;

  return {
    categories: taxonomy.categories
      .filter((c) => c.active !== false)
      .map((c) => ({ value: c.code, label: c.label.en ?? c.code })),
    priorities: taxonomy.priorities.map((p) => ({
      value: p.code,
      label: p.label.en ?? p.code,
    })),
    sensitivity: taxonomy.sensitivity_classes.map((s) => ({
      value: s.code,
      label: s.label.en ?? s.code,
      restricted: s.restricted === true,
    })),
  };
}

function sensitivityIsRestricted(taxonomy: Cd03Taxonomy, code: string): boolean {
  const cls = taxonomy.sensitivity_classes.find((s) => s.code === code);
  return cls?.restricted === true;
}

function canSetSensitivity(access: UserAccess, taxonomy: Cd03Taxonomy, code: string): boolean {
  if (!sensitivityIsRestricted(taxonomy, code)) return true;
  return (
    hasPermission(access.permissions, 'sensitive:handle') ||
    access.sensitiveClasses.includes(code)
  );
}

function valuesEqual(field: string, from: unknown, to: unknown): boolean {
  if (field === 'categories') {
    const a = [...coerceIntakeStringArray(from)].sort().join(',');
    const b = [...coerceIntakeStringArray(to)].sort().join(',');
    return a === b;
  }
  if (field === 'date_occurred') {
    const fromDate = from ? new Date(String(from)).toISOString().slice(0, 10) : '';
    const toDate = to ? new Date(String(to)).toISOString().slice(0, 10) : '';
    return fromDate === toDate;
  }
  const a = from === null || from === undefined ? '' : String(from);
  const b = to === null || to === undefined ? '' : String(to);
  return a === b;
}

export async function updateCaseFields(
  tenantId: string,
  caseId: string,
  actorId: string,
  access: UserAccess,
  rawBody: unknown,
): Promise<
  | { ok: false; code: 400 | 403 | 404 | 422 | 503; error: string; message?: string }
  | {
      ok: true;
      case: {
        summary: string;
        description: string | null;
        expected_outcome: string | null;
        date_occurred: string | null;
        categories: string[];
        priority: string;
        sensitivity: string;
        unit_id: string | null;
        unit: string | null;
        level: string;
      };
    }
> {
  const parsed = patchCaseFieldsBody.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, code: 400, error: 'invalid_body', message: parsed.error.message };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { ok: false, code: 404, error: 'not_found' };

  const allowed = await canAccessCase(tenantId, access, actorId, {
    unitId: caseRow.unitId,
    assigneeId: caseRow.assigneeId,
    sensitivity: caseRow.sensitivity,
  });
  if (!allowed) return { ok: false, code: 404, error: 'not_found' };

  const [taxonomy, hierarchy] = await Promise.all([
    getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy'),
    getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy'),
  ]);
  if (!taxonomy || !hierarchy) {
    return { ok: false, code: 503, error: 'tenant_not_configured' };
  }

  const updates: Partial<typeof schema.grmCase.$inferInsert> = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [field, rawValue] of Object.entries(parsed.data.fields)) {
    if (field === 'summary') {
      const summary = coerceIntakeString(rawValue);
      if (!summary) {
        return { ok: false, code: 422, error: 'summary_required', message: 'Summary cannot be empty.' };
      }
      if (!valuesEqual('summary', caseRow.summary, summary)) {
        changes.summary = { from: caseRow.summary, to: summary };
        updates.summary = summary;
      }
      continue;
    }

    if (field === 'description' || field === 'expected_outcome') {
      const text = coerceIntakeString(rawValue);
      const current = field === 'description' ? caseRow.description : caseRow.expectedOutcome;
      if (!valuesEqual(field, current, text)) {
        changes[field] = { from: current, to: text };
        if (field === 'description') updates.description = text;
        else updates.expectedOutcome = text;
      }
      continue;
    }

    if (field === 'date_occurred') {
      const next = rawValue === null || rawValue === '' ? null : parseIntakeDate(rawValue);
      if (rawValue !== null && rawValue !== '' && !next) {
        return { ok: false, code: 422, error: 'invalid_date', message: 'Invalid date.' };
      }
      const current = caseRow.dateOccurred;
      if (!valuesEqual('date_occurred', current, next)) {
        changes.date_occurred = { from: current, to: next };
        updates.dateOccurred = next;
      }
      continue;
    }

    if (field === 'categories') {
      const categoryCodes = new Set(taxonomy.categories.filter((c) => c.active !== false).map((c) => c.code));
      const categories = coerceIntakeStringArray(rawValue).filter((c) => categoryCodes.has(c));
      if (!valuesEqual('categories', caseRow.categories, categories)) {
        changes.categories = { from: caseRow.categories, to: categories };
        updates.categories = categories;
      }
      continue;
    }

    if (field === 'priority') {
      const priority = coerceIntakeString(rawValue);
      const priorityCodes = new Set(taxonomy.priorities.map((p) => p.code));
      if (!priority || !priorityCodes.has(priority)) {
        return { ok: false, code: 422, error: 'invalid_priority' };
      }
      if (!valuesEqual('priority', caseRow.priority, priority)) {
        changes.priority = { from: caseRow.priority, to: priority };
        updates.priority = priority;
      }
      continue;
    }

    if (field === 'sensitivity') {
      const sensitivity = coerceIntakeString(rawValue);
      const sensitivityCodes = new Set(taxonomy.sensitivity_classes.map((s) => s.code));
      if (!sensitivity || !sensitivityCodes.has(sensitivity)) {
        return { ok: false, code: 422, error: 'invalid_sensitivity' };
      }
      if (!canSetSensitivity(access, taxonomy, sensitivity)) {
        return {
          ok: false,
          code: 403,
          error: 'forbidden',
          message: 'sensitive:handle required for restricted sensitivity classes.',
        };
      }
      if (!valuesEqual('sensitivity', caseRow.sensitivity, sensitivity)) {
        changes.sensitivity = { from: caseRow.sensitivity, to: sensitivity };
        updates.sensitivity = sensitivity;
      }
      continue;
    }

    if (field === 'unit_id') {
      const unitId = coerceIntakeString(rawValue);
      if (!unitId) {
        if (caseRow.unitId !== null) {
          const intakeLevels = hierarchyIntakeLevels(hierarchy);
          changes.unit_id = { from: caseRow.unitId, to: null };
          updates.unitId = null;
          updates.levelCode = intakeLevels[0]?.code ?? caseRow.levelCode;
        }
        continue;
      }

      const [unitRow] = await db
        .select()
        .from(schema.unit)
        .where(and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.id, unitId)))
        .limit(1);
      if (!unitRow) return { ok: false, code: 422, error: 'unknown_unit' };

      const allowedLevelCodes = await intakeUnitLevelCodes(tenantId, hierarchy);
      const unitLevelAllowsIntake = allowedLevelCodes.some(
        (code) => code.toLowerCase() === unitRow.levelCode.toLowerCase(),
      );
      if (!unitLevelAllowsIntake) {
        return {
          ok: false,
          code: 422,
          error: 'unit_not_at_intake_level',
          message: 'That location cannot accept grievances.',
        };
      }

      if (!valuesEqual('unit_id', caseRow.unitId, unitId)) {
        changes.unit_id = { from: caseRow.unitId, to: unitId };
        updates.unitId = unitId;
        updates.levelCode = unitRow.levelCode;
      }
    }
  }

  if (Object.keys(changes).length === 0) {
    let unitName: string | null = null;
    if (caseRow.unitId) {
      const [u] = await db
        .select({ name: schema.unit.name })
        .from(schema.unit)
        .where(eq(schema.unit.id, caseRow.unitId))
        .limit(1);
      unitName = u?.name ?? null;
    }
    return {
      ok: true,
      case: {
        summary: caseRow.summary,
        description: caseRow.description,
        expected_outcome: caseRow.expectedOutcome,
        date_occurred: caseRow.dateOccurred?.toISOString() ?? null,
        categories: caseRow.categories,
        priority: caseRow.priority,
        sensitivity: caseRow.sensitivity,
        unit_id: caseRow.unitId,
        unit: unitName,
        level: caseRow.levelCode,
      },
    };
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.grmCase).set(updates).where(eq(schema.grmCase.id, caseId));

    for (const [field, change] of Object.entries(changes)) {
      await tx.insert(schema.caseEvent).values({
        tenantId,
        caseId,
        kind: 'field_edited',
        actorType: 'staff',
        actorId,
        visibility: 'internal',
        data: { field, from: change.from, to: change.to },
      });
    }
  });

  await writeAudit({
    tenantId,
    actorId,
    action: 'case.fields_updated',
    entity: 'grm_case',
    entityId: caseId,
    data: { fields: Object.keys(changes) },
  });

  const [updated] = await db
    .select()
    .from(schema.grmCase)
    .where(eq(schema.grmCase.id, caseId))
    .limit(1);

  let unitName: string | null = null;
  if (updated?.unitId) {
    const [u] = await db
      .select({ name: schema.unit.name })
      .from(schema.unit)
      .where(eq(schema.unit.id, updated.unitId))
      .limit(1);
    unitName = u?.name ?? null;
  }

  return {
    ok: true,
    case: {
      summary: updated!.summary,
      description: updated!.description,
      expected_outcome: updated!.expectedOutcome,
      date_occurred: updated!.dateOccurred?.toISOString() ?? null,
      categories: updated!.categories,
      priority: updated!.priority,
      sensitivity: updated!.sensitivity,
      unit_id: updated!.unitId,
      unit: unitName,
      level: updated!.levelCode,
    },
  };
}
