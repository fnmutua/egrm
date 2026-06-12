import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
/** Short-TTL cache of active config versions (config changes are rare, reads are hot). */
const cache = new Map();
const TTL_MS = 15_000;
export async function getActiveConfig(tenantId, domain) {
    const key = `${tenantId}:${domain}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS)
        return hit.payload;
    const [row] = await db
        .select({ payload: schema.configVersion.payload })
        .from(schema.configVersion)
        .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, domain), eq(schema.configVersion.status, 'active')))
        .limit(1);
    const payload = row?.payload ?? null;
    cache.set(key, { payload, at: Date.now() });
    return payload;
}
export function invalidateConfigCache(tenantId, domain) {
    if (domain)
        cache.delete(`${tenantId}:${domain}`);
    else
        for (const k of cache.keys())
            if (k.startsWith(`${tenantId}:`))
                cache.delete(k);
}
//# sourceMappingURL=config.js.map