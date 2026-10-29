import { query, withTransaction } from '../db.js';
import { ConflictError, NotFoundError } from '../errors.js';

const PLAN_COLUMNS = `id, title, description, start_date, end_date, budget, currency,
  is_public, version, created_at, updated_at`;
const LOCATION_COLUMNS = `id, travel_plan_id, name, address, latitude, longitude, visit_order,
  arrival_date, departure_date, budget, notes, created_at, updated_at`;

export async function listPlans({ page, limit }) {
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    // Page first (index on updated_at), then count locations only for that page.
    query(
      `SELECT ${PLAN_COLUMNS},
              (SELECT COUNT(*)::int FROM locations l WHERE l.travel_plan_id = p.id) AS location_count
         FROM travel_plans p
        ORDER BY p.updated_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    query('SELECT COUNT(*)::int AS n FROM travel_plans'),
  ]);
  return { items: rows.rows, total: total.rows[0].n };
}

export async function createPlan(fields) {
  const cols = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await query(
    `INSERT INTO travel_plans (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
     RETURNING ${PLAN_COLUMNS}`,
    values,
  );
  return rows[0];
}

export async function getPlanWithLocations(id) {
  const plan = await query(`SELECT ${PLAN_COLUMNS} FROM travel_plans WHERE id = $1`, [id]);
  if (!plan.rows.length) throw new NotFoundError('Travel plan');
  const locations = await query(
    `SELECT ${LOCATION_COLUMNS} FROM locations WHERE travel_plan_id = $1 ORDER BY visit_order`,
    [id],
  );
  return { ...plan.rows[0], locations: locations.rows };
}

// Problem 1 (lost update): optimistic locking. The UPDATE succeeds only if the row still has
// the version the client read; otherwise 0 rows change and we answer 409 with the current version.
export async function updatePlan(id, fields, expectedVersion) {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`);
  sets.push('version = version + 1');
  const { rows } = await query(
    `UPDATE travel_plans SET ${sets.join(', ')}
      WHERE id = $1 AND version = $2
      RETURNING ${PLAN_COLUMNS}`,
    [id, expectedVersion, ...Object.values(fields)],
  );
  if (rows.length) return rows[0];

  const current = await query('SELECT version FROM travel_plans WHERE id = $1', [id]);
  if (!current.rows.length) throw new NotFoundError('Travel plan');
  throw new ConflictError(current.rows[0].version);
}

export async function deletePlan(id) {
  const { rowCount } = await query('DELETE FROM travel_plans WHERE id = $1', [id]);
  if (!rowCount) throw new NotFoundError('Travel plan');
}

// Locks the parent plan row for the rest of the transaction (used to serialise location ordering).
export async function lockPlan(client, id) {
  const { rows } = await client.query('SELECT id FROM travel_plans WHERE id = $1 FOR UPDATE', [id]);
  if (!rows.length) throw new NotFoundError('Travel plan');
}

export { LOCATION_COLUMNS, withTransaction };
