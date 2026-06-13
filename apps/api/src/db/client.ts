import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { env } from '../env.js';
import { pgPoolConfig } from './pg-config.js';

export const pool = new pg.Pool(pgPoolConfig(env.DATABASE_URL));
export const db = drizzle(pool, { schema });
export { schema };
