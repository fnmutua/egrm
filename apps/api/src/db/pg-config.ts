import type { PoolConfig } from 'pg';

const CLOUD_PG_HOSTS = ['railway.app', 'railway.internal', 'neon.tech', 'supabase.co'];

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

function isCloudPgHost(host: string): boolean {
  return CLOUD_PG_HOSTS.some((marker) => host.includes(marker));
}

export function isManagedPostgresUrl(connectionString: string): boolean {
  return isCloudPgHost(hostFromUrl(connectionString));
}

/** Shared pg connection options for local dev and managed Postgres (Railway, etc.). */
export function pgPoolConfig(connectionString: string): PoolConfig {
  const sslmode = sslModeFromUrl(connectionString);
  const host = hostFromUrl(connectionString);
  const useSsl =
    sslmode === 'require' ||
    sslmode === 'verify-full' ||
    sslmode === 'verify-ca' ||
    isCloudPgHost(host) ||
    (process.env.NODE_ENV === 'production' && sslmode !== 'disable');

  const config: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: 15_000,
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}
