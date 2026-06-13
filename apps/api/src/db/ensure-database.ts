import pg from 'pg';

type PgError = Error & { code?: string };

function maintenanceUrl(connectionString: string): { dbName: string; url: string } {
  const url = new URL(connectionString);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name (e.g. …/egrm).');
  }
  url.pathname = '/postgres';
  return { dbName, url: url.toString() };
}

export function formatDatabaseError(err: unknown, connectionString: string): string {
  const pgErr = err as PgError;
  const host = (() => {
    try {
      return new URL(connectionString).host;
    } catch {
      return 'your database server';
    }
  })();

  if (pgErr.code === '28P01') {
    return [
      'PostgreSQL authentication failed.',
      'Set DATABASE_URL in apps/api/.env with your local postgres user and password.',
      'Example: postgres://postgres:<password>@localhost:5432/egrm',
    ].join('\n');
  }
  if (pgErr.code === 'ECONNREFUSED') {
    return `Cannot connect to PostgreSQL at ${host}. Ensure the server is running.`;
  }
  if (pgErr.code === 'ENOTFOUND') {
    return `Cannot resolve PostgreSQL host (${host}). Check DATABASE_URL in apps/api/.env.`;
  }
  if (pgErr instanceof Error) return pgErr.message;
  return String(err);
}

/** Create the application database if it does not exist (connects via the `postgres` maintenance DB). */
export async function ensureDatabase(connectionString: string): Promise<void> {
  const { dbName, url } = maintenanceUrl(connectionString);
  const client = new pg.Client({ connectionString: url });

  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[db] created database "${dbName}"`);
    } else {
      console.log(`[db] database "${dbName}" already exists`);
    }
  } catch (err) {
    throw new Error(formatDatabaseError(err, connectionString), { cause: err });
  } finally {
    await client.end();
  }
}
