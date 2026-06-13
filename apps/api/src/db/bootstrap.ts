/**
 * Production deploy bootstrap: apply migrations, then idempotent seed when appropriate.
 * Used by Railway preDeployCommand and `pnpm db:bootstrap`.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool, schema } from './client.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';

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
      console.error('[bootstrap] failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
