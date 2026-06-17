/** Run pending SQL migrations on startup (Railway / production) and via `pnpm db:migrate`. */
import crypto from 'node:crypto';
import fs from 'node:fs';
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

type Journal = { entries: { tag: string }[] };

function migrationHash(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/** Apply journal SQL files missing from drizzle history (e.g. added to journal after later migrations ran). */
async function applyMissingJournalMigrations(pool: pg.Pool): Promise<void> {
  const journalPath = path.join(migrationsFolder, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
  const applied = await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations');
  const appliedHashes = new Set(applied.rows.map((row) => row.hash));

  for (const entry of journal.entries) {
    const filePath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(filePath)) continue;

    const sql = fs.readFileSync(filePath, 'utf8');
    const hash = migrationHash(sql);
    if (appliedHashes.has(hash)) continue;

    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
        hash,
        Date.now(),
      ]);
      await pool.query('COMMIT');
      appliedHashes.add(hash);
      console.log(`[migrate] applied missing migration ${entry.tag}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
}

export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool(pgPoolConfig(env.DATABASE_URL));
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder });
    await applyMissingJournalMigrations(pool);
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
