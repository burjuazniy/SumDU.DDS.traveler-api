// Moves one vnode database to another shard server with almost no write downtime.
//   node scripts/shard-move.js <vnode hex digit> <target host:port>
//   e.g. node scripts/shard-move.js 3 postgres_01:5432
//
// 1. Creates the vnode database on the target server (schema + application grants).
// 2. Logical replication: publication on the source, subscription (copy_data) on the target.
// 3. Waits for the initial table sync.
// 4. Takes EXCLUSIVE locks on the source tables (writes block, reads continue) and waits until
//    the target holds exactly the same rows.
// 5. Detaches the subscription: the target copy becomes the writable master.
// 6. Rewrites mapping.json (atomic rename).
// 7. Revokes the application's privileges on the old copy and releases the locks. Blocked and
//    future writes to the old copy fail with insufficient_privilege (42501); the application
//    reacts by re-reading mapping.json and retrying on the new server (see src/db.js).
// Admin credentials: SHARD_ADMIN_USER / SHARD_ADMIN_PASSWORD (superuser on all shard servers).
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const [digit, target] = process.argv.slice(2);
if (!/^[0-9a-f]$/.test(digit || '') || !/^[\w.-]+:\d+$/.test(target || '')) {
  console.error('usage: node scripts/shard-move.js <vnode 0-f> <target host:port>');
  process.exit(2);
}
const mapFile = process.env.SHARD_MAP || 'shards/mapping.json';
const admin = process.env.SHARD_ADMIN_USER || 'travel';
const adminPassword = process.env.SHARD_ADMIN_PASSWORD || 'travel';
const appUser = process.env.APP_DB_USER || process.env.DB_USER || 'traveler_app';
const migrations = fileURLToPath(new URL('../db/migrations/', import.meta.url));

const map = JSON.parse(readFileSync(mapFile, 'utf8'));
const source = map[digit];
const [sourceHostPort, dbName] = source.split('/');
const [sourceHost, sourcePort] = sourceHostPort.split(':');
if (sourceHostPort === target) throw new Error(`vnode ${digit} is already on ${target}`);

const conn = (hostPort, db) => new pg.Client(
  `postgres://${encodeURIComponent(admin)}:${encodeURIComponent(adminPassword)}@${hostPort}/${db}`);
const pub = `move_${dbName}`;
const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fingerprint = async (client) => (await client.query(`
  SELECT (SELECT count(*) FROM travel_plans) AS plans,
         (SELECT count(*) FROM locations) AS locations,
         (SELECT md5(coalesce(string_agg(id::text || ':' || version, ',' ORDER BY id), '')) FROM travel_plans) AS plans_md5,
         (SELECT md5(coalesce(string_agg(id::text || ':' || visit_order || ':' || updated_at, ',' ORDER BY id), '')) FROM locations) AS loc_md5`)).rows[0];

log(`moving vnode ${digit} (${dbName}) ${sourceHostPort} -> ${target}`);

// 1. Target database with schema and grants.
const targetAdmin = conn(target, 'postgres');
await targetAdmin.connect();
await targetAdmin.query(`CREATE DATABASE ${dbName}`);
await targetAdmin.end();
const dst = conn(target, dbName);
await dst.connect();
for (const f of readdirSync(migrations).filter((x) => x.endsWith('.sql')).sort()) {
  await dst.query(readFileSync(join(migrations, f), 'utf8'));
}
// The source may have DDL applied later with shard-exec.js (new columns, indexes): bring the
// target schema up to the source, otherwise logical replication fails on a missing column.
const src = conn(sourceHostPort, dbName);
await src.connect();
const { rows: srcCols } = await src.query(`
  SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE c.relname IN ('travel_plans', 'locations') AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY c.relname, a.attnum`);
const { rows: dstCols } = await dst.query(`
  SELECT table_name AS tbl, column_name AS col FROM information_schema.columns
   WHERE table_name IN ('travel_plans', 'locations')`);
const have = new Set(dstCols.map((c) => `${c.tbl}.${c.col}`));
for (const c of srcCols.filter((x) => !have.has(`${x.tbl}.${x.col}`))) {
  await dst.query(`ALTER TABLE ${c.tbl} ADD COLUMN ${c.col} ${c.type}${c.def ? ` DEFAULT ${c.def}` : ''}${c.notnull ? ' NOT NULL' : ''}`);
  log(`schema sync: added ${c.tbl}.${c.col} ${c.type}`);
}
const { rows: srcIdx } = await src.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'");
const { rows: dstIdx } = await dst.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
const haveIdx = new Set(dstIdx.map((i) => i.indexname));
for (const i of srcIdx.filter((x) => !haveIdx.has(x.indexname))) {
  await dst.query(i.indexdef);
  log(`schema sync: created index ${i.indexname}`);
}
await dst.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${appUser};
  GRANT USAGE ON SCHEMA public TO ${appUser};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appUser}`);
log('target database created');

// 2. Publication + subscription.
await src.query(`CREATE PUBLICATION ${pub} FOR TABLE travel_plans, locations`);
await dst.query(`CREATE SUBSCRIPTION ${pub}
  CONNECTION 'host=${sourceHost} port=${sourcePort} dbname=${dbName} user=${admin} password=${adminPassword}'
  PUBLICATION ${pub} WITH (copy_data = true, slot_name = '${pub}')`);
log('logical replication started');

// 3. Initial copy (give up after 2 minutes: the subscription is left for inspection, mapping untouched).
for (let i = 0; ; i++) {
  const { rows: [r] } = await dst.query(`SELECT count(*)::int AS pending FROM pg_subscription_rel sr
    JOIN pg_subscription s ON s.oid = sr.srsubid WHERE s.subname = $1 AND sr.srsubstate <> 'r'`, [pub]);
  if (r.pending === 0) break;
  if (i > 600) throw new Error(`initial sync of ${pub} did not finish in 120 s; see the target server log`);
  await sleep(200);
}
log(`initial sync done: ${JSON.stringify(await fingerprint(dst))}`);

// 4. Freeze writes on the source and wait until the target is identical.
await src.query('BEGIN');
await src.query('LOCK TABLE travel_plans, locations IN EXCLUSIVE MODE');
const lockedAt = Date.now();
log('source tables locked (writes blocked, reads allowed)');
const want = await fingerprint(src);
for (let i = 0; ; i++) {
  const got = await fingerprint(dst);
  if (JSON.stringify(got) === JSON.stringify(want)) break;
  if (i > 300) { await src.query('ROLLBACK'); throw new Error('target did not catch up in 60 s, aborted'); }
  await sleep(200);
}
log(`target caught up: ${want.plans} plans, ${want.locations} locations`);

// 5. Promote: detach the subscription (keep data), drop the slot and publication on the source.
await dst.query(`ALTER SUBSCRIPTION ${pub} DISABLE`);
await dst.query(`ALTER SUBSCRIPTION ${pub} SET (slot_name = NONE)`);
await dst.query(`DROP SUBSCRIPTION ${pub}`);
const srcAux = conn(sourceHostPort, dbName);
await srcAux.connect();
for (let i = 0; i < 50; i++) {
  const { rows } = await srcAux.query('SELECT active FROM pg_replication_slots WHERE slot_name = $1', [pub]);
  if (!rows.length || !rows[0].active) break;
  await sleep(100);
}
await srcAux.query('SELECT pg_drop_replication_slot($1) FROM pg_replication_slots WHERE slot_name = $1', [pub]);
await srcAux.end();
log('subscription detached, target is now the master copy');

// 6. New mapping.
map[digit] = `${target}/${dbName}`;
writeFileSync(`${mapFile}.tmp`, `${JSON.stringify(map, null, 2)}\n`);
renameSync(`${mapFile}.tmp`, mapFile);
log(`${mapFile} updated: ${digit} -> ${map[digit]}`);

// 7. Signal the application and release the locks.
await src.query(`REVOKE ALL ON travel_plans, locations FROM ${appUser}`);
await src.query(`DROP PUBLICATION ${pub}`);
await src.query('COMMIT');
log(`old copy revoked, locks released (writes were blocked for ${Date.now() - lockedAt} ms)`);
await src.end();
await dst.end();
log(`done. Old database ${dbName} on ${sourceHostPort} is kept read-only for the admin; drop it when safe.`);
