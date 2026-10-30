import { readFileSync } from 'node:fs';
import pg from 'pg';
import { config } from './config.js';

// NUMERIC -> JS number (budgets, coordinates); DATE -> plain 'YYYY-MM-DD' string (no timezone shift).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

// A database handle: query() plus withTransaction(fn), which runs fn(client) inside BEGIN/COMMIT.
function makeDb(connectionString, max, name) {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (err) => console.error(`[db ${name}] idle client error: ${err.message}`));
  return {
    name,
    pool,
    query: (text, params) => pool.query(text, params),
    async withTransaction(fn) {
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
    },
  };
}

export const sharded = Boolean(config.shardMap);
const single = sharded ? null : makeDb(config.databaseUrl, config.poolSize, 'main');

// ---------------------------------------------------------------------------------------------
// Sharding (lab 6). SHARD_MAP points to mapping.json: {"0": "postgres_00:5432/db_0", ..., "f": ...}.
// Every UUID ends with the hex digit of its vnode; locations reuse the digit of their plan,
// so a plan and its locations always live in the same database.
// ---------------------------------------------------------------------------------------------
const HEX = '0123456789abcdef';
let vnodes = null;

function loadShardMap() {
  const map = JSON.parse(readFileSync(config.shardMap, 'utf8'));
  const next = {};
  for (const d of HEX) {
    if (!map[d]) throw new Error(`${config.shardMap}: no database for vnode "${d}"`);
    const same = vnodes && vnodes[d].target === map[d];
    next[d] = same ? vnodes[d] : {
      target: map[d],
      db: makeDb(`postgres://${encodeURIComponent(config.dbUser)}:${encodeURIComponent(config.dbPassword)}@${map[d]}`,
        config.shardPoolSize, `vnode ${d} @ ${map[d]}`),
    };
  }
  const old = vnodes;
  vnodes = next;
  // Close replaced pools later: requests that started on them may still be running.
  if (old) for (const d of HEX) if (old[d] !== next[d]) setTimeout(() => old[d].db.pool.end().catch(() => {}), 30_000).unref();
}
if (sharded) loadShardMap();

// The rebalancing tool revokes table privileges on the old copy of a moved vnode. The app sees
// insufficient_privilege (42501), re-reads mapping.json and retries once on the new location.
async function withRemap(digit, op) {
  // Remember which copy this request used: a concurrent request may already have reloaded the map.
  const used = vnodes[digit];
  try {
    return await op(used.db);
  } catch (err) {
    if (err.code !== '42501') throw err;
    if (vnodes[digit] === used) loadShardMap();
    if (vnodes[digit].target === used.target) throw err;
    console.log(`vnode ${digit} moved: ${used.target} -> ${vnodes[digit].target}`);
    return op(vnodes[digit].db);
  }
}

const vnodeDb = (digit) => ({
  name: `vnode ${digit}`,
  query: (text, params) => withRemap(digit, (db) => db.query(text, params)),
  withTransaction: (fn) => withRemap(digit, (db) => db.withTransaction(fn)),
});

export const shardOf = (uuid) => uuid.slice(-1).toLowerCase();
export const dbFor = (uuid) => (sharded ? vnodeDb(shardOf(uuid)) : single);
export const allDbs = () => (sharded ? HEX.split('').map(vnodeDb) : [single]);
export const shardTargets = () => (sharded ? Object.fromEntries(HEX.split('').map((d) => [d, vnodes[d].target])) : null);
export const closeAll = () => Promise.all(sharded ? HEX.split('').map((d) => vnodes[d].db.pool.end()) : [single.pool.end()]);
