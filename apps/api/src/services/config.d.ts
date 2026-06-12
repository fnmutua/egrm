import type { ConfigDomain } from '@egrm/core';
export declare function getActiveConfig<T = unknown>(tenantId: string, domain: ConfigDomain): Promise<T | null>;
export declare function invalidateConfigCache(tenantId: string, domain?: ConfigDomain): void;
//# sourceMappingURL=config.d.ts.map