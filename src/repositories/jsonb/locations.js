// Lab 8: locations inside travel_plans.locations (JSONB array).
// Concurrency: every change locks the single plan row (SELECT ... FOR UPDATE), edits the array in
// the application and writes it back in the same transaction. One row per aggregate means the
// row lock alone serialises all writers of a plan - problems 2 and 3 cannot occur.
import { randomUUID } from 'node:crypto';
import { dbFor, shardOf } from '../../db.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import { presentLocation } from './plans.js';

const locationIdFor = (planId) => randomUUID().slice(0, -1) + shardOf(planId);
const byLocationId = (id) => JSON.stringify([{ id }]);

function checkRange(loc) {
  if (loc.arrival_date && loc.departure_date && new Date(loc.departure_date) < new Date(loc.arrival_date)) {
    throw new ValidationError(['departure_date must not be before arrival_date']);
  }
}

export function addLocation(planId, fields) {
  return dbFor(planId).withTransaction(async (client) => {
    const { rows } = await client.query('SELECT locations FROM travel_plans WHERE id = $1 FOR UPDATE', [planId]);
    if (!rows.length) throw new NotFoundError('Travel plan');
    const list = rows[0].locations;
    const now = new Date().toISOString();
    const loc = {
      id: locationIdFor(planId),
      ...fields,
      visit_order: list.reduce((m, l) => Math.max(m, l.visit_order), 0) + 1,
      created_at: now,
      updated_at: now,
    };
    await client.query('UPDATE travel_plans SET locations = locations || $2::jsonb WHERE id = $1',
      [planId, JSON.stringify([loc])]);
    return presentLocation(planId, loc);
  });
}

export function updateLocation(id, fields) {
  return dbFor(id).withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, locations FROM travel_plans WHERE locations @> $1::jsonb FOR UPDATE', [byLocationId(id)]);
    if (!rows.length) throw new NotFoundError('Location');
    const { id: planId, locations } = rows[0];
    const me = locations.find((l) => l.id === id);

    if (fields.visit_order !== undefined && fields.visit_order !== me.visit_order) {
      const other = locations.find((l) => l.visit_order === fields.visit_order);
      if (other) other.visit_order = me.visit_order; // swap positions
    }
    Object.assign(me, fields, { updated_at: new Date().toISOString() });
    checkRange(me);

    await client.query('UPDATE travel_plans SET locations = $2::jsonb WHERE id = $1', [planId, JSON.stringify(locations)]);
    return presentLocation(planId, me);
  });
}

export function deleteLocation(id) {
  return dbFor(id).withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE travel_plans
          SET locations = (SELECT coalesce(jsonb_agg(l), '[]'::jsonb)
                             FROM jsonb_array_elements(locations) l WHERE l->>'id' <> $1)
        WHERE locations @> $2::jsonb`,
      [id, byLocationId(id)]);
    if (!rowCount) throw new NotFoundError('Location');
  });
}
