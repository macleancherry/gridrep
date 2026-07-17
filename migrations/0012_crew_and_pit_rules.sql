-- Crew roles (PRD §14). Driving assignments are derived live from race_plan_stints (a
-- stint's [start_offset, pit_target_offset) interval already *is* that driver's driving
-- window) rather than duplicated here - this table only stores spotting assignments,
-- which are genuinely freeform and don't share the stints' lap/fuel structure.
CREATE TABLE IF NOT EXISTS race_plan_duty_assignments (
  id TEXT PRIMARY KEY,
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'spotting',
  start_time_offset_minutes REAL NOT NULL,
  end_time_offset_minutes REAL NOT NULL,
  FOREIGN KEY (race_plan_id) REFERENCES race_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_duty_assignments_plan ON race_plan_duty_assignments (race_plan_id);

-- Configurable per-plan fatigue threshold (PRD §14.5) - default 120min per the team's
-- ~55min single-stint car giving a clean buffer above a normal double stint.
ALTER TABLE race_plans ADD COLUMN fatigue_threshold_minutes INTEGER NOT NULL DEFAULT 120;

-- Shared pit-stop rules per event (PRD §15.2) - captured once, reused by every team
-- planning the same event, same pattern as event_condition_profiles.
CREATE TABLE IF NOT EXISTS event_pit_rules (
  event_id TEXT PRIMARY KEY,
  tyre_change_interval_stints INTEGER,   -- e.g. 1 = every stint, 2 = every double-stint
  simultaneous_fuel_tyres INTEGER NOT NULL DEFAULT 1,
  base_pit_time_seconds INTEGER NOT NULL DEFAULT 55,
  sequential_time_penalty_seconds INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- 'preset' | 'manual' | 'derived'
  submitted_by TEXT,
  submitted_at TEXT NOT NULL,
  flagged_as_outdated INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

-- Pit-time stat alongside pace/fuel (PRD §15.3) - schema only for now; deriving it from
-- in-lap/out-lap deltas or a Garage 61 field is follow-up work, manual entry in the
-- meantime (same measured-vs-manual pattern as fuel).
ALTER TABLE driver_track_profiles ADD COLUMN pit_time_seconds REAL;
ALTER TABLE driver_track_profiles ADD COLUMN pit_time_source TEXT;
