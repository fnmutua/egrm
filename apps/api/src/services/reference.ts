import { sql } from 'drizzle-orm';
import type { Cd07Numbering } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';

/**
 * Concurrency-safe reference allocation (GEN-INT-08).
 * Atomic upsert-increment on (tenant, scope) — no max()+1 string parsing.
 */
export async function allocateReference(tenantId: string, numbering: Cd07Numbering): Promise<string> {
  const year = String(new Date().getFullYear());
  const scopeKey = numbering.scope === 'yearly' ? year : 'global';

  const result = await db
    .insert(schema.caseSequence)
    .values({ tenantId, scopeKey, nextValue: 2 })
    .onConflictDoUpdate({
      target: [schema.caseSequence.tenantId, schema.caseSequence.scopeKey],
      set: { nextValue: sql`${schema.caseSequence.nextValue} + 1` },
    })
    .returning({ nextValue: schema.caseSequence.nextValue });

  // After upsert, nextValue is the *next* number; the allocated one is nextValue - 1.
  const seq = result[0]!.nextValue - 1;

  return numbering.pattern
    .replaceAll('{YYYY}', year)
    .replace(/\{seq:(\d+)\}/, (_, width) => String(seq).padStart(Number(width), '0'));
}
