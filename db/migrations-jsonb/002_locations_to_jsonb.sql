-- Lab 8: move locations into a JSONB array inside travel_plans (document model).
-- Idempotent: safe to run on an empty database or on one that still has the locations table.
BEGIN;

ALTER TABLE travel_plans
  ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE travel_plans DROP CONSTRAINT IF EXISTS check_locations_array;
ALTER TABLE travel_plans
  ADD CONSTRAINT check_locations_array CHECK (jsonb_typeof(locations) = 'array');

-- Copy existing rows (ordered by visit_order) and drop the old table.
DO $$
BEGIN
  IF to_regclass('public.locations') IS NOT NULL THEN
    UPDATE travel_plans p
       SET locations = sub.arr
      FROM (
        SELECT travel_plan_id,
               jsonb_agg(
                 jsonb_strip_nulls(jsonb_build_object(
                   'id', id, 'name', name, 'address', address,
                   'latitude', latitude, 'longitude', longitude, 'visit_order', visit_order,
                   'arrival_date', arrival_date, 'departure_date', departure_date,
                   'budget', budget, 'notes', notes,
                   'created_at', created_at, 'updated_at', updated_at))
                 ORDER BY visit_order) AS arr
          FROM locations
         GROUP BY travel_plan_id
      ) sub
     WHERE sub.travel_plan_id = p.id;
    DROP TABLE locations;
  END IF;
END $$;

-- PUT/DELETE /api/locations/{id} look the plan up by a location id: locations @> '[{"id": "..."}]'
CREATE INDEX IF NOT EXISTS idx_travel_plans_locations
  ON travel_plans USING GIN (locations jsonb_path_ops);

COMMIT;
