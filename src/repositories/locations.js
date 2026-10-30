import { randomUUID } from 'node:crypto';
import { dbFor, shardOf } from '../db.js';
import { NotFoundError } from '../errors.js';
import { LOCATION_COLUMNS, lockPlan } from './plans.js';

// A location id ends with the same hex digit as its plan id, so PUT/DELETE /api/locations/{id}
// can find the shard from the location id alone.
const locationIdFor = (planId) => randomUUID().slice(0, -1) + shardOf(planId);

// Problem 2 (duplicate visit_order): two concurrent inserts must not both read the same MAX().
// We take a row lock on the parent plan (SELECT ... FOR UPDATE), so inserts into one plan are
// serialised while inserts into different plans still run in parallel. The UNIQUE
// (travel_plan_id, visit_order) constraint is the last line of defence.
export function addLocation(planId, fields) {
  return dbFor(planId).withTransaction(async (client) => {
    await lockPlan(client, planId);
    const cols = Object.keys(fields);
    const values = Object.values(fields);
    const { rows } = await client.query(
      `INSERT INTO locations (id, travel_plan_id, visit_order${cols.map((c) => `, ${c}`).join('')})
       SELECT $1, $2, COALESCE(MAX(visit_order), 0) + 1${cols.map((_, i) => `, $${i + 3}`).join('')}
         FROM locations WHERE travel_plan_id = $2
       RETURNING ${LOCATION_COLUMNS}`,
      [locationIdFor(planId), planId, ...values],
    );
    return rows[0];
  });
}

// Problem 3 (concurrent edits of different fields): the update is a single UPDATE that only
// touches the columns present in the request, executed under the row lock PostgreSQL takes
// for UPDATE. There is no read-modify-write in the application, so A's budget change and
// B's notes change both survive.
// Changing visit_order swaps positions with the location currently holding that order.
export function updateLocation(id, fields) {
  return dbFor(id).withTransaction(async (client) => {
    const found = await client.query('SELECT travel_plan_id, visit_order FROM locations WHERE id = $1', [id]);
    if (!found.rows.length) throw new NotFoundError('Location');
    const { travel_plan_id: planId } = found.rows[0];

    if (fields.visit_order !== undefined) {
      await lockPlan(client, planId);
      const { rows: [me] } = await client.query('SELECT visit_order FROM locations WHERE id = $1', [id]);
      if (!me) throw new NotFoundError('Location');
      await client.query('SET CONSTRAINTS unique_plan_order DEFERRED');
      await client.query(
        `UPDATE locations SET visit_order = $1
          WHERE travel_plan_id = $2 AND visit_order = $3 AND id <> $4`,
        [me.visit_order, planId, fields.visit_order, id],
      );
    }

    const cols = Object.keys(fields);
    if (!cols.length) {
      const { rows } = await client.query(`SELECT ${LOCATION_COLUMNS} FROM locations WHERE id = $1`, [id]);
      return rows[0];
    }
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    const { rows } = await client.query(
      `UPDATE locations SET ${sets.join(', ')} WHERE id = $1 RETURNING ${LOCATION_COLUMNS}`,
      [id, ...Object.values(fields)],
    );
    if (!rows.length) throw new NotFoundError('Location');
    return rows[0];
  });
}

export async function deleteLocation(id) {
  const { rowCount } = await dbFor(id).query('DELETE FROM locations WHERE id = $1', [id]);
  if (!rowCount) throw new NotFoundError('Location');
}
