import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { logger } from './logger.js';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

neonConfig.webSocketConstructor = ws;

let pool: Pool | null = null;
let dbInstance: NeonDatabase<typeof schema> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL env var is not set');
  }
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err: Error) => {
    logger.error('Unexpected DB pool error', { error: err.message });
  });
  return pool;
}

export function getDb(): NeonDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(getPool(), { schema });
  return dbInstance;
}
