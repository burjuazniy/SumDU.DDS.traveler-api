-- Failure example: the DDL succeeds on 15 databases and fails on db_7,
-- so shard-exec.js must roll back all 16 (no database may end up with the column).
ALTER TABLE travel_plans ADD COLUMN IF NOT EXISTS rating SMALLINT;
DO $$
BEGIN
  IF current_database() = 'db_7' THEN
    RAISE EXCEPTION 'simulated failure on %', current_database();
  END IF;
END $$;
