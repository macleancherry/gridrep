-- Pace: iRacing league lap sync & clean-pace calculation (standalone product, path /pace)

CREATE TABLE IF NOT EXISTS pace_leagues (
  league_id TEXT PRIMARY KEY,        -- iRacing's league_id
  name TEXT NOT NULL,
  last_synced_at TEXT,               -- ISO timestamp marker for incremental sync
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pace_subsessions (
  subsession_id TEXT PRIMARY KEY,
  league_id TEXT,                    -- NULL for manually-entered subsessions
  track_name TEXT,
  series_name TEXT,
  start_time TEXT,
  ingested_at TEXT NOT NULL,
  FOREIGN KEY (league_id) REFERENCES pace_leagues(league_id)
);

CREATE TABLE IF NOT EXISTS pace_laps (
  subsession_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  simsession_number INTEGER NOT NULL,  -- iRacing's simsession_number (identifies which sim-session)
  simsession_type TEXT NOT NULL,       -- normalized: 'qualifying' | 'race'
  lap_number INTEGER NOT NULL,
  lap_time_ms INTEGER,
  flags_raw INTEGER,
  flags_decoded TEXT,                  -- JSON array of decoded flag names, as observed from the API
  is_pit_lap INTEGER NOT NULL DEFAULT 0,
  is_clean INTEGER,                    -- derived; nullable so it can be recomputed/backfilled later
  created_at TEXT NOT NULL,
  PRIMARY KEY (subsession_id, cust_id, simsession_number, lap_number),
  FOREIGN KEY (subsession_id) REFERENCES pace_subsessions(subsession_id)
);

CREATE INDEX IF NOT EXISTS idx_pace_laps_lookup
ON pace_laps (subsession_id, simsession_number, cust_id);
