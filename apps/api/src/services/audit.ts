import { db, schema } from '../db/client.js';

/** Every config change, auth event and (later) case action lands here (GEN-SEC-07). */
export async function writeAudit(entry: {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  data?: unknown;
}) {
  await db.insert(schema.auditEvent).values({
    tenantId: entry.tenantId,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    data: entry.data,
  });
}
