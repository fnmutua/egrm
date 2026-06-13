/** Run pending SQL migrations on startup (Railway / production) and via `pnpm db:migrate`. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../env.js';
import { ensureDatabase } from './ensure-database.js';
import { isManagedPostgresUrl, pgPoolConfig } from './pg-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool(pgPoolConfig(env.DATABASE_URL));
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder });
    console.log('[migrate] up to date');
  } finally {
    await pool.end();
  }
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliEntry()) {
  try {
    // Managed Postgres (Railway, etc.) provisions the database; only create locally.
    if (process.env.NODE_ENV !== 'production' && !isManagedPostgresUrl(env.DATABASE_URL)) {
      await ensureDatabase(env.DATABASE_URL);
    }
    await runMigrations();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? `\n  cause: ${err.cause.message}` : '';
    console.error(`[migrate] failed: ${message}${cause}`);
    process.exit(1);
  }
}
