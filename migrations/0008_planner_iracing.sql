-- Race Planner: planner-owned iRacing data model (independent of pace_* tables).
-- Ported from Pace's proven pace_leagues/pace_subsessions/pace_laps design (0005-0007),
-- with zero foreign keys into anything Pace owns - Pace is slated for removal and the
-- planner must not break when it goes. Reuses the shared `drivers` table for driver
-- identity, same as Pace does, since that table is core gridrep infra, not Pace-specific.

-- A special/endurance event instance - shared across every team that plans it. Keyed on
-- event + scheduled start datetime so multiple splits of the same running resolve to one
-- record (matters for condition-profile sharing, see event_condition_profiles below).
CREATE TABLE IF NOT EXISTS iracing_events (
  id TEXT PRIMARY KEY,                 -- generated (e.g. series_id/season_id + start_time)
  name TEXT NOT NULL,
  track_name TEXT,
  track_config TEXT,
  event_type TEXT NOT NULL,            -- 'special' | 'hosted' | 'league'
  scheduled_start_time TEXT,           -- ISO 8601 UTC
  duration_minutes INTEGER,
  series_id TEXT,
  season_id TEXT,
  source TEXT NOT NULL,                -- 'iracing_data_api' | 'manual'
  created_at TEXT NOT NULL
);

-- Shared forecast/condition profile(s) for an event instance - captured once, reused by
-- every team that selects the same event (PRD §5.3). Multiple rows per event support the
-- "Start/Day", "Night", "Dawn" segment split an endurance race needs (PRD §6).
CREATE TABLE IF NOT EXISTS event_condition_profiles (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  label TEXT NOT NULL,                 -- e.g. "Day", "Dusk", "Night", "Dawn"
  window_offset_start_minutes INTEGER, -- offset from race start
  window_offset_end_minutes INTEGER,
  expected_track_temp_min REAL,
  expected_track_temp_max REAL,
  expected_air_temp_min REAL,
  expected_air_temp_max REAL,
  expected_track_state TEXT,           -- 'dry' | 'green-damp' | 'wet' | etc.
  expected_precip_pct INTEGER,
  expected_wind TEXT,
  source TEXT NOT NULL,                -- 'screenshot_ai' | 'manual'
  submitted_by TEXT,                   -- users.id
  submitted_at TEXT NOT NULL,
  was_edited_before_save INTEGER NOT NULL DEFAULT 0,
  flagged_as_outdated INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

CREATE INDEX IF NOT EXISTS idx_event_condition_profiles_event
ON event_condition_profiles (event_id);

-- Planner-owned league follow list - independent copy of pace_leagues's design.
CREATE TABLE IF NOT EXISTS planner_iracing_leagues (
  league_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  host_cust_id TEXT,
  session_name_filter TEXT             -- at least one of host_cust_id/session_name_filter
                                        -- required - search_hosted 400s on league_id alone
);

-- Planner-owned subsession cache - independent copy of pace_subsessions's design, plus
-- per-session weather/track-state fields Pace doesn't capture (PRD §7). These are
-- best-effort/nullable: whether iRacing's results payload actually carries them per
-- session is still unconfirmed pending a live-token spike (see plan report §6).
CREATE TABLE IF NOT EXISTS planner_iracing_subsessions (
  subsession_id TEXT PRIMARY KEY,
  league_id TEXT,                      -- NULL for manually-pulled subsessions
  event_id TEXT,                       -- NULL until matched to a discovered event
  track_name TEXT,
  series_name TEXT,
  start_time TEXT,
  ingested_at TEXT NOT NULL,
  laps_complete INTEGER NOT NULL DEFAULT 0,
  track_temp REAL,
  air_temp REAL,
  track_state TEXT,
  time_of_day TEXT,                    -- 'day' | 'dusk' | 'night' | 'dawn'
  FOREIGN KEY (league_id) REFERENCES planner_iracing_leagues(league_id),
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

-- Planner-owned lap cache - independent copy of pace_laps's design (same field shape,
-- proven by Pace), keyed identically for the same idempotent-upsert-on-resume behavior.
CREATE TABLE IF NOT EXISTS planner_iracing_laps (
  subsession_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  simsession_number INTEGER NOT NULL,
  simsession_type TEXT NOT NULL,       -- normalized: 'qualifying' | 'race'
  lap_number INTEGER NOT NULL,
  lap_time_ms INTEGER,
  flags_raw INTEGER,
  flags_decoded TEXT,                  -- JSON array of decoded flag names
  is_pit_lap INTEGER NOT NULL DEFAULT 0,
  is_clean INTEGER,                    -- 1/0/NULL - NULL means "couldn't classify"
  created_at TEXT NOT NULL,
  PRIMARY KEY (subsession_id, cust_id, simsession_number, lap_number),
  FOREIGN KEY (subsession_id) REFERENCES planner_iracing_subsessions(subsession_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_iracing_laps_lookup
ON planner_iracing_laps (subsession_id, simsession_number, cust_id);
