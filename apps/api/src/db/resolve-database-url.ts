/** Railway private host — only resolvable inside a deployed replica. */
export function isRailwayInternalHost(connectionString: string): boolean {
  try {
    return new URL(connectionString).hostname.includes('railway.internal');
  } catch {
    return false;
  }
}

/**
 * Prefer Railway's public proxy URL when `railway run` injects an internal host
 * that cannot be resolved from a developer machine.
 *
 * Inside a running Railway container (`RAILWAY_REPLICA_ID` set), keep the
 * internal URL for lower latency and no public egress.
 */
export function resolveDatabaseUrl(connectionString: string): string {
  const publicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  if (!publicUrl) return connectionString;
  if (!isRailwayInternalHost(connectionString)) return connectionString;
  if (process.env.RAILWAY_REPLICA_ID) return connectionString;
  return publicUrl;
}
