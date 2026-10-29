// Applies every db/migrations/*.sql file in name order (all files are idempotent).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  await pool.query(await readFile(join(dir, file), 'utf8'));
  console.log(`applied ${file}`);
}
await pool.end();
