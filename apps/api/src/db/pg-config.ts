import type { PoolConfig } from 'pg';

/** Hosts that require TLS (public proxies). Internal Railway DNS does not use SSL. */
const SSL_PG_HOSTS = ['railway.app', 'rlwy.net', 'neon.tech', 'supabase.co'];

/** Managed Postgres — skip local `CREATE DATABASE` and similar bootstrap steps. */
const MANAGED_PG_HOSTS = [...SSL_PG_HOSTS, 'railway.internal'];

function sslModeFromUrl(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get('sslmode') ?? undefined;
  } catch {
    return undefined;
  }
}

function hostFromUrl(connectionString: string): string {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(host: string, markers: string[]): boolean {
  return markers.some((marker) => host.includes(marker));
}

function requiresSsl(host: string): boolean {
  if (host.includes('railway.internal')) return false;
  return hostMatches(host, SSL_PG_HOSTS);
}

export function isManagedPostgresUrl(connectionString: string): boolean {
  return hostMatches(hostFromUrl(connectionString), MANAGED_PG_HOSTS);
}

/** Shared pg connection options for local dev and managed Postgres (Railway, etc.). */
export function pgPoolConfig(connectionString: string): PoolConfig {
  const sslmode = sslModeFromUrl(connectionString);
  const host = hostFromUrl(connectionString);
  const useSsl =
    sslmode === 'require' ||
    sslmode === 'verify-full' ||
    sslmode === 'verify-ca' ||
    requiresSsl(host) ||
    (process.env.NODE_ENV === 'production' && sslmode !== 'disable' && !host.includes('railway.internal'));

  const config: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: 15_000,
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}
