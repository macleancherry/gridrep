-- Driver availability & scheduling (PRD §13).
ALTER TABLE users ADD COLUMN timezone TEXT; -- IANA string, auto-populated client-side on first submit

-- Only populated when an event genuinely has multiple scheduled start options (PRD §13.1) -
-- most events (a single global green-flag time) never get a row here, and plans just use
-- the event's own scheduled_start_time as the race's UTC anchor.
CREATE TABLE IF NOT EXISTS race_plan_time_slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  label TEXT NOT NULL,
  start_datetime_utc TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', -- 'iracing_schedule' | 'manual'
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

ALTER TABLE race_plans ADD COLUMN time_slot_id TEXT REFERENCES race_plan_time_slots(id);
ALTER TABLE race_plans ADD COLUMN availability_block_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE race_plans ADD COLUMN race_duration_minutes INTEGER; -- falls back to the event's own duration, then 1440

CREATE TABLE IF NOT EXISTS driver_availability (
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  block_start_offset_minutes INTEGER NOT NULL, -- from green flag
  status TEXT NOT NULL,                        -- 'available' | 'maybe' | 'unavailable'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (race_plan_id, cust_id, block_start_offset_minutes),
  FOREIGN KEY (race_plan_id) REFERENCES race_plans(id)
);
