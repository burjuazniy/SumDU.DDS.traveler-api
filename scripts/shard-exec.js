// Applies one SQL file (DDL or DML) to all 16 vnode databases atomically.
//   node scripts/shard-exec.js path/to/script.sql [--dry-run]
// Every database runs the file inside its own transaction. Only if all 16 succeed are they
// committed, using two-phase commit (PREPARE TRANSACTION / COMMIT PREPARED), so a crash between
// the commits of different databases cannot leave the shards half-migrated: a prepared
// transaction survives restarts and is finished by re-running COMMIT PREPARED.
// Requires max_prepared_transactions > 0 on the shard servers.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/shard-exec.js <script.sql> [--dry-run]');
  process.exit(2);
}
const dryRun = flag === '--dry-run';
const sql = readFileSync(file, 'utf8');
const map = JSON.parse(readFileSync(process.env.SHARD_MAP || 'shards/mapping.json', 'utf8'));
const user = encodeURIComponent(process.env.SHARD_ADMIN_USER || 'travel');
const password = encodeURIComponent(process.env.SHARD_ADMIN_PASSWORD || 'travel');
const gid = `shard_exec_${Date.now()}`;

const shards = Object.entries(map).map(([digit, target]) => ({
  digit, target, client: new pg.Client(`postgres://${user}:${password}@${target}`), prepared: false,
}));

let failed = null;
try {
  await Promise.all(shards.map((s) => s.client.connect()));
  // Phase 1: run the script and PREPARE everywhere; stop at the first failure.
  const results = await Promise.allSettled(shards.map(async (s) => {
    await s.client.query('BEGIN');
    const res = await s.client.query(sql);
    const rows = [].concat(res).reduce((n, r) => n + (r.rowCount || 0), 0);
    if (!dryRun) {
      await s.client.query(`PREPARE TRANSACTION '${gid}_${s.digit}'`);
      s.prepared = true;
    }
    return rows;
  }));
  results.forEach((r, i) => {
    const s = shards[i];
    if (r.status === 'rejected') {
      failed = failed || r.reason;
      console.log(`  vnode ${s.digit} (${s.target}): FAILED - ${r.reason.message}`);
    } else {
      console.log(`  vnode ${s.digit} (${s.target}): ok, ${r.value} row(s) affected`);
    }
  });
} catch (err) {
  failed = err;
}

// Phase 2: commit everything or roll everything back.
if (failed || dryRun) {
  await Promise.all(shards.map((s) => (s.prepared
    ? s.client.query(`ROLLBACK PREPARED '${gid}_${s.digit}'`)
    : s.client.query('ROLLBACK')).catch(() => {})));
  console.log(dryRun ? 'dry run: rolled back on all 16 databases' : `ROLLED BACK on all databases: ${failed.message}`);
} else {
  await Promise.all(shards.map((s) => s.client.query(`COMMIT PREPARED '${gid}_${s.digit}'`)));
  console.log(`COMMITTED on all ${shards.length} databases (2PC id ${gid})`);
}
await Promise.all(shards.map((s) => s.client.end().catch(() => {})));
process.exit(failed ? 1 : 0);
