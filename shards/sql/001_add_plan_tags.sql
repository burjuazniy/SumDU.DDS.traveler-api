-- DDL example for scripts/shard-exec.js: applied to all 16 vnode databases or to none.
ALTER TABLE travel_plans ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_travel_plans_tags ON travel_plans USING GIN (tags);
