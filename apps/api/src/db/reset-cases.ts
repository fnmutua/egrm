/**
 * Delete all case data (cases, parties, threads, notifications, attachments) and reset
 * reference sequences. Does not remove tenants, users, config, or jurisdiction units.
 *
 * Usage: pnpm db:reset-cases
 *        TENANT_CODE=kisip pnpm db:reset-cases   # single tenant only
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, schema } from './client.js';
import { deleteAttachmentBlob } from '../services/attachment-storage.js';

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

export async function resetCases(tenantCode?: string): Promise<void> {
  const tenantIds = await resolveTenantIds(tenantCode);
  if (!tenantIds.length) {
    console.log('[reset-cases] no tenants found');
    return;
  }

  const scope = tenantCode ?? 'all tenants';
  console.log(`[reset-cases] clearing case data for ${scope}…`);

  const attachmentRows = await db
    .select({ storageKey: schema.caseAttachment.storageKey })
    .from(schema.caseAttachment)
    .where(inArray(schema.caseAttachment.tenantId, tenantIds));

  let blobsRemoved = 0;
  for (const row of attachmentRows) {
    try {
      await deleteAttachmentBlob(row.storageKey);
      blobsRemoved++;
    } catch {
      // Missing file on disk is fine during reset.
    }
  }

  await db.transaction(async (tx) => {
    const forTenant = (table: { tenantId: typeof schema.grmCase.tenantId }) =>
      inArray(table.tenantId, tenantIds);

    const counts = {
      notification_log: Number((await tx.delete(schema.notificationLog).where(forTenant(schema.notificationLog))).rowCount ?? 0),
      notification_outbox: Number((await tx.delete(schema.notificationOutbox).where(forTenant(schema.notificationOutbox))).rowCount ?? 0),
      case_attachment: Number((await tx.delete(schema.caseAttachment).where(forTenant(schema.caseAttachment))).rowCount ?? 0),
      thread_entry: Number((await tx.delete(schema.threadEntry).where(forTenant(schema.threadEntry))).rowCount ?? 0),
      case_event: Number((await tx.delete(schema.caseEvent).where(forTenant(schema.caseEvent))).rowCount ?? 0),
      grm_case: Number((await tx.delete(schema.grmCase).where(forTenant(schema.grmCase))).rowCount ?? 0),
      party: Number((await tx.delete(schema.party).where(forTenant(schema.party))).rowCount ?? 0),
      case_sequence: Number((await tx.delete(schema.caseSequence).where(forTenant(schema.caseSequence))).rowCount ?? 0),
    };

    console.log('[reset-cases] deleted rows:', counts);
  });

  console.log('[reset-cases] complete');
  console.log(`  tenants:     ${tenantIds.length}`);
  console.log(`  blob files:  ${blobsRemoved} removed from disk`);
  console.log('  tables:      notification_log, notification_outbox, case_attachment,');
  console.log('               thread_entry, case_event, grm_case, party, case_sequence');
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliEntry()) {
  const tenantCode = process.env.TENANT_CODE?.trim() || process.argv[2]?.trim() || undefined;
  try {
    await resetCases(tenantCode);
  } catch (err) {
    console.error('[reset-cases] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
