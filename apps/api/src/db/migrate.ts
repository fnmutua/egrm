/** Run pending SQL migrations on startup (Railway / production). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log('[migrate] up to date');
} finally {
  await pool.end();
}
