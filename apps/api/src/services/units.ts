import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/** Case unit plus every ancestor up the tree (inclusive). Empty when unitId is null. */
export async function unitSelfAndAncestors(tenantId: string, unitId: string | null): Promise<string[]> {
  if (!unitId) return [];
  const units = await db
    .select({ id: schema.unit.id, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));
  const byId = new Map(units.map((u) => [u.id, u.parentId]));
  const chain: string[] = [];
  let cur: string | null | undefined = unitId;
  while (cur) {
    chain.push(cur);
    cur = byId.get(cur) ?? null;
  }
  return chain;
}
