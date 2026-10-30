// Lab 8: document model. A plan row carries its locations as a JSONB array, so
// "plan with locations" is one row read and every location change is one row update.
import { randomUUID } from 'node:crypto';
import { dbFor } from '../../db.js';
import { ConflictError, NotFoundError } from '../../errors.js';

export const PLAN_COLUMNS = `id, title, description, start_date, end_date, budget, currency,
  is_public, version, created_at, updated_at`;

// JSONB keeps whatever the client sent; normalise to the same shape the relational API returns.
const NUMERIC = ['latitude', 'longitude', 'budget'];
const TIMES = ['arrival_date', 'departure_date', 'created_at', 'updated_at'];
const LOCATION_FIELDS = ['id', 'travel_plan_id', 'name', 'address', 'latitude', 'longitude', 'visit_order',
  'arrival_date', 'departure_date', 'budget', 'notes', 'created_at', 'updated_at'];

export function presentLocation(planId, loc) {
  const out = {};
  for (const f of LOCATION_FIELDS) {
    let v = f === 'travel_plan_id' ? planId : loc[f];
    if (v === undefined) v = null;
    if (v !== null && NUMERIC.includes(f)) v = Number(v);
    if (v !== null && TIMES.includes(f)) v = new Date(v).toISOString();
    out[f] = v;
  }
  return out;
}

export const presentLocations = (planId, arr) => [...arr]
  .sort((a, b) => a.visit_order - b.visit_order)
  .map((l) => presentLocation(planId, l));

export async function listPlans({ page, limit }) {
  const db = dbFor();
  const [rows, total] = await Promise.all([
    db.query(`SELECT ${PLAN_COLUMNS}, jsonb_array_length(locations) AS location_count
                FROM travel_plans ORDER BY updated_at DESC LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit]),
    db.query('SELECT COUNT(*)::int AS n FROM travel_plans'),
  ]);
  return { items: rows.rows, total: total.rows[0].n };
}

export async function createPlan(fields) {
  const id = randomUUID();
  const cols = ['id', ...Object.keys(fields)];
  const values = [id, ...Object.values(fields)];
  const { rows } = await dbFor(id).query(
    `INSERT INTO travel_plans (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING ${PLAN_COLUMNS}`,
    values,
  );
  return rows[0];
}

export async function getPlanWithLocations(id) {
  const { rows } = await dbFor(id).query(`SELECT ${PLAN_COLUMNS}, locations FROM travel_plans WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Travel plan');
  const { locations, ...plan } = rows[0];
  return { ...plan, locations: presentLocations(id, locations) };
}

// Optimistic locking is unchanged: the version check and the update are one statement.
export async function updatePlan(id, fields, expectedVersion) {
  const db = dbFor(id);
  const cols = Object.keys(fields);
  const sets = [...cols.map((c, i) => `${c} = $${i + 3}`), 'version = version + 1'];
  const { rows } = await db.query(
    `UPDATE travel_plans SET ${sets.join(', ')} WHERE id = $1 AND version = $2 RETURNING ${PLAN_COLUMNS}`,
    [id, expectedVersion, ...Object.values(fields)],
  );
  if (rows.length) return rows[0];
  const current = await db.query('SELECT version FROM travel_plans WHERE id = $1', [id]);
  if (!current.rows.length) throw new NotFoundError('Travel plan');
  throw new ConflictError(current.rows[0].version);
}

export async function deletePlan(id) {
  // Locations are part of the row: no cascade needed.
  const { rowCount } = await dbFor(id).query('DELETE FROM travel_plans WHERE id = $1', [id]);
  if (!rowCount) throw new NotFoundError('Travel plan');
}
