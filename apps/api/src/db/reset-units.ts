/**
 * Delete all jurisdiction units for one or all tenants. Clears unit scoping on
 * user roles and unlinks cases from units (cases are kept).
 *
 * Usage: pnpm db:reset-units
 *        TENANT_CODE=kisip pnpm db:reset-units
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, pool, schema } from './client.js';

async function resolveTenantIds(tenantCode?: string): Promise<string[]> {
  if (tenantCode) {
    const [row] = await db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.code, tenantCode.toLowerCase()))
      .limit(1);
    if (!row) throw new Error(`Unknown tenant: ${tenantCode}`);
    return [row.id];
  }
  const rows = await db.select({ id: schema.tenant.id }).from(schema.tenant);
  return rows.map((r) => r.id);
}

export async function resetUnits(tenantCode?: string): Promise<{
  units: number;
  casesUnlinked: number;
  rolesCleared: number;
}> {
  const tenantIds = await resolveTenantIds(tenantCode);
  if (!tenantIds.length) {
    console.log('[reset-units] no tenants found');
    return { units: 0, casesUnlinked: 0, rolesCleared: 0 };
  }

  const scope = tenantCode ?? 'all tenants';
  console.log(`[reset-units] clearing jurisdiction units for ${scope}…`);

  const unitRows = await db
    .select({ id: schema.unit.id })
    .from(schema.unit)
    .where(inArray(schema.unit.tenantId, tenantIds));
  const unitIds = unitRows.map((r) => r.id);

  if (!unitIds.length) {
    console.log('[reset-units] no units to delete');
    return { units: 0, casesUnlinked: 0, rolesCleared: 0 };
  }

  let counts = { units: 0, casesUnlinked: 0, rolesCleared: 0 };

  await db.transaction(async (tx) => {
    counts.rolesCleared = Number(
      (await tx
        .update(schema.userRole)
        .set({ unitId: null })
        .where(inArray(schema.userRole.unitId, unitIds))).rowCount ?? 0,
    );

    counts.casesUnlinked = Number(
      (await tx
        .update(schema.grmCase)
        .set({ unitId: null })
        .where(and(inArray(schema.grmCase.tenantId, tenantIds), isNotNull(schema.grmCase.unitId)))).rowCount ?? 0,
    );

    counts.units = Number(
      (await tx.delete(schema.unit).where(inArray(schema.unit.tenantId, tenantIds))).rowCount ?? 0,
    );
  });

  console.log('[reset-units] complete');
  console.log('  units deleted:    ', counts.units);
  console.log('  cases unlinked:   ', counts.casesUnlinked);
  console.log('  role scopes cleared:', counts.rolesCleared);

  return counts;
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliEntry()) {
  const tenantCode = process.env.TENANT_CODE?.trim() || process.argv[2]?.trim() || undefined;
  try {
    await resetUnits(tenantCode);
  } catch (err) {
    console.error('[reset-units] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
