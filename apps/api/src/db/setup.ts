/** Fresh-install bootstrap: .env → create DB → migrate → seed. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ensureEnvFile, assertEnvConfigured } from './ensure-env.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

ensureEnvFile();
dotenv.config({ path: path.join(apiRoot, '.env') });
assertEnvConfigured();

const { env } = await import('../env.js');
const { ensureDatabase } = await import('./ensure-database.js');
const { runMigrations } = await import('./migrate.js');
const { runSeed } = await import('./seed.js');

try {
  await ensureDatabase(env.DATABASE_URL);
  await runMigrations();
  await runSeed();
  console.log('[setup] Database ready.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
