/**
 * Production deploy bootstrap: apply migrations, then idempotent seed when appropriate.
 * Used by Railway preDeployCommand and `pnpm db:bootstrap`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool, schema } from './client.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Safety net when migration journal says 0014 ran but the table is missing. */
async function ensureStaffInboxTable(): Promise<void> {
  const reg = await pool.query<{ reg: string | null }>(
    `SELECT to_regclass('public.staff_inbox_notification') AS reg`,
  );
  if (reg.rows[0]?.reg) return;

  const sqlFile = path.resolve(__dirname, '../../drizzle/0014_staff_inbox.sql');
  await pool.query(readFileSync(sqlFile, 'utf8'));
  console.log('[bootstrap] created missing staff_inbox_notification table');
}

function seedFlag(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return undefined;
}

async function shouldRunSeed(): Promise<boolean> {
  const forced = seedFlag('SEED_ON_DEPLOY');
  if (forced === true) return true;
  if (forced === false) return false;

  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tenant);
  return (row?.n ?? 0) === 0;
}

export async function runBootstrap(): Promise<void> {
  console.log('[bootstrap] running migrations…');
  await runMigrations();
  await ensureStaffInboxTable();

  if (await shouldRunSeed()) {
    console.log('[bootstrap] running seed…');
    await runSeed();
  } else {
    console.log('[bootstrap] seed skipped (database already seeded; set SEED_ON_DEPLOY=1 to force)');
  }

  console.log('[bootstrap] complete');
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliEntry()) {
  runBootstrap()
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause instanceof Error ? `\n  cause: ${err.cause.message}` : '';
      console.error(`[bootstrap] failed: ${message}${cause}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
