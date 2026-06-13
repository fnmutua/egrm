import { and, eq, notInArray } from 'drizzle-orm';
import type { Cd10OrgAccess } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';

/** Upsert tenant roles from an active CD-10 payload; remove roles no longer defined. */
export async function syncRolesFromOrgAccess(tenantId: string, payload: Cd10OrgAccess) {
  const names = payload.roles.map((r) => r.name);

  for (const roleDef of payload.roles) {
    const [existing] = await db
      .select()
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, roleDef.name)))
      .limit(1);

    if (existing) {
      await db
        .update(schema.role)
        .set({
          label: roleDef.label,
          permissions: roleDef.permissions,
          sensitiveClasses: roleDef.sensitive_classes ?? [],
          mfaRequired: roleDef.mfa_required ?? false,
          parentRoleName: roleDef.parent_role ?? null,
        })
        .where(eq(schema.role.id, existing.id));
    } else {
      await db.insert(schema.role).values({
        tenantId,
        name: roleDef.name,
        label: roleDef.label,
        permissions: roleDef.permissions,
        sensitiveClasses: roleDef.sensitive_classes ?? [],
        mfaRequired: roleDef.mfa_required ?? false,
        parentRoleName: roleDef.parent_role ?? null,
      });
    }
  }

  if (names.length > 0) {
    await db
      .delete(schema.role)
      .where(and(eq(schema.role.tenantId, tenantId), notInArray(schema.role.name, names)));
  }
}
