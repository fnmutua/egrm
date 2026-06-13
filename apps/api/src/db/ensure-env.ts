import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(apiRoot, '../..');

const ENV_PATH = path.join(apiRoot, '.env');
const EXAMPLE_PATH = path.join(repoRoot, '.env.example');

const PLACEHOLDER = 'YOUR_LOCAL_PG_PASSWORD';

/** Copy `.env.example` → `apps/api/.env` on first run. Returns whether the file was just created. */
export function ensureEnvFile(): boolean {
  if (fs.existsSync(ENV_PATH)) return false;
  if (!fs.existsSync(EXAMPLE_PATH)) {
    throw new Error(`Missing ${EXAMPLE_PATH}. Cannot bootstrap apps/api/.env.`);
  }
  fs.copyFileSync(EXAMPLE_PATH, ENV_PATH);
  console.log('[setup] Created apps/api/.env from .env.example');
  return true;
}

/** Exit with a clear message when DATABASE_URL still has the placeholder password. */
export function assertEnvConfigured(): void {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const match = raw.match(/^DATABASE_URL=(.+)$/m);
  const value = match?.[1]?.trim() ?? '';
  if (value.includes(PLACEHOLDER)) {
    console.error('[setup] Edit apps/api/.env and set DATABASE_URL to your local Postgres credentials.');
    console.error('        Example: postgres://postgres:<your-password>@localhost:5432/egrm');
    process.exit(1);
  }
}
