// Applies every db/migrations/*.sql file in name order (all files are idempotent).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { allDbs, closeAll } from '../src/db.js';

// STORAGE=jsonb additionally applies db/migrations-jsonb (lab 8).
const dirs = ['../db/migrations/', ...(config.storage === 'jsonb' ? ['../db/migrations-jsonb/'] : [])]
  .map((d) => fileURLToPath(new URL(d, import.meta.url)));
for (const dir of dirs) for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = await readFile(join(dir, file), 'utf8');
  for (const db of allDbs()) await db.query(sql);
  console.log(`applied ${file} to ${allDbs().length} database(s)`);
}
await closeAll();
