-- Users (verified via iRacing OAuth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                 -- internal uuid
  iracing_member_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Drivers (public profiles)
CREATE TABLE IF NOT EXISTS drivers (
  iracing_member_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Sessions (races)
CREATE TABLE IF NOT EXISTS sessions (
  iracing_session_id TEXT PRIMARY KEY,
  start_time TEXT NOT NULL,
  series_name TEXT,
  track_name TEXT,
  split INTEGER,
  sof INTEGER
);

-- Session participants
CREATE TABLE IF NOT EXISTS session_participants (
  iracing_session_id TEXT NOT NULL,
  iracing_member_id TEXT NOT NULL,
  finish_pos INTEGER,
  car_name TEXT,
  PRIMARY KEY (iracing_session_id, iracing_member_id),
  FOREIGN KEY (iracing_session_id) REFERENCES sessions(iracing_session_id),
  FOREIGN KEY (iracing_member_id) REFERENCES drivers(iracing_member_id)
);

-- Props (GG) with reason/category
CREATE TABLE IF NOT EXISTS props (
  id TEXT PRIMARY KEY,
  iracing_session_id TEXT NOT NULL,
  to_iracing_member_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,               -- e.g. clean_battle
  created_at TEXT NOT NULL,
  FOREIGN KEY (iracing_session_id) REFERENCES sessions(iracing_session_id),
  FOREIGN KEY (to_iracing_member_id) REFERENCES drivers(iracing_member_id),
  FOREIGN KEY (from_user_id) REFERENCES users(id)
);

-- One prop per giver -> recipient -> session
CREATE UNIQUE INDEX IF NOT EXISTS uq_props_unique
ON props (from_user_id, iracing_session_id, to_iracing_member_id);

CREATE INDEX IF NOT EXISTS idx_props_to_driver
ON props (to_iracing_member_id);

CREATE INDEX IF NOT EXISTS idx_props_session
ON props (iracing_session_id);

CREATE INDEX IF NOT EXISTS idx_props_reason
ON props (reason);
