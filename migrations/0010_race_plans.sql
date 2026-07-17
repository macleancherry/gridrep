-- Race plans + stints (PRD §7, §4 step 6). Pit-stop-rule modeling (event_pit_rules,
-- §15) lands separately - race_plans.pit_stop_seconds is a simple manual value that
-- stands in for it until then, so plan/stint CRUD can work end-to-end in the meantime.
CREATE TABLE IF NOT EXISTS race_plans (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT,
  car_name TEXT,
  fuel_tank_capacity_liters REAL,
  pit_stop_seconds INTEGER NOT NULL DEFAULT 55,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

CREATE INDEX IF NOT EXISTS idx_race_plans_event ON race_plans (event_id);

-- Lineup is a simple driver list per plan (no roster/team model exists yet, PRD §10.3).
CREATE TABLE IF NOT EXISTS race_plan_lineup (
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  PRIMARY KEY (race_plan_id, cust_id),
  FOREIGN KEY (race_plan_id) REFERENCES race_plans(id)
);

-- Snapshots pace_ms/fuel_per_lap at save time (rather than re-deriving from
-- driver_track_profiles on every read) so a saved plan stays self-consistent even if a
-- driver's profile is recomputed later under different conditions.
CREATE TABLE IF NOT EXISTS race_plan_stints (
  id TEXT PRIMARY KEY,
  race_plan_id TEXT NOT NULL,
  stint_order INTEGER NOT NULL,
  cust_id TEXT NOT NULL,
  lap_count INTEGER NOT NULL,
  pace_ms INTEGER NOT NULL,
  fuel_per_lap REAL NOT NULL,
  start_offset_minutes REAL NOT NULL,
  duration_minutes REAL NOT NULL,
  fuel_load_liters REAL NOT NULL,
  pit_target_offset_minutes REAL NOT NULL,
  fuel_warning INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (race_plan_id) REFERENCES race_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_race_plan_stints_plan ON race_plan_stints (race_plan_id, stint_order);
