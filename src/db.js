import pg from 'pg';
import { config } from './config.js';

// NUMERIC -> JS number (budgets, coordinates); DATE -> plain 'YYYY-MM-DD' string (no timezone shift).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.poolSize,
});

export const query = (text, params) => pool.query(text, params);

// Runs fn(client) inside BEGIN/COMMIT, rolling back on any error.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
