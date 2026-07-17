-- Driver track/condition profiles (PRD §7): per driver, per track, per condition profile -
-- computed clean pace (ported logic, §5.1) plus fuel-per-lap (measured/manual, §5.2/§5.4).
-- id is deterministic (cust_id:track_name:condition_profile_id, "none" when unfiltered) so
-- recomputing just upserts in place rather than needing a nullable-column unique index.
CREATE TABLE IF NOT EXISTS driver_track_profiles (
  id TEXT PRIMARY KEY,
  cust_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  condition_profile_id TEXT,           -- NULL = computed across all conditions at this track
  pace_ms INTEGER,
  laps_used INTEGER,
  sample_size INTEGER NOT NULL DEFAULT 0,
  widened_band INTEGER NOT NULL DEFAULT 0, -- 1 if the ±temp band had to widen to reach best-N
  fuel_per_lap REAL,
  fuel_source TEXT,                    -- 'measured' | 'manual'
  computed_at TEXT NOT NULL,
  FOREIGN KEY (cust_id) REFERENCES drivers(iracing_member_id),
  FOREIGN KEY (condition_profile_id) REFERENCES event_condition_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_driver_track_profiles_lookup
ON driver_track_profiles (cust_id, track_name);
