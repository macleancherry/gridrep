-- 0022_teams_invites_weekends.sql
--
-- Teams/invites/race-weekends (PRD: "Teams, invites, and a jobs-to-be-done navigation
-- model", 2026-07-20). Introduces the persistent coordinator-owned roster concept that's
-- never existed in this app (race_plan_lineup's own comment in 0010 says so directly),
-- plus a Race Weekend wrapper around today's race_plans so a single real-world event can
-- eventually hold more than one Car Entry.

-- Teams: persistent, coordinator-owned roster container. Exists independently of any one
-- race - a coordinator builds it once and plans many race weekends against it.
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Team roster. cust_id-first (same pattern as the existing `drivers` table) so a
-- coordinator can add someone via the existing global iRacing search before that person
-- has ever signed into gridrep - user_id backfills once they accept the invite and
-- actually sign in, at which point status flips from 'invited' to 'active'.
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL DEFAULT 'driver',    -- 'coordinator' | 'driver'
  status TEXT NOT NULL DEFAULT 'invited', -- 'invited' | 'active'
  invited_at TEXT NOT NULL,
  joined_at TEXT,
  PRIMARY KEY (team_id, cust_id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- One active reusable invite link per team - regenerating replaces it (old token then
-- 404s via revoked_at). Not single-use per-driver: the real usage pattern is "post this
-- link in our Discord channel", where multiple people click the same link.
CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,          -- the token used in the /race-planner/join/:token URL
  team_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);

-- A driver's own recurring weekly free-time pattern, in their own timezone
-- (users.timezone, migration 0011). Projected onto a specific race weekend's real
-- calendar days to prefill that weekend's driver_availability rows.
CREATE TABLE IF NOT EXISTS driver_availability_template (
  user_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,          -- 0=Sunday .. 6=Saturday
  start_minute_of_day INTEGER NOT NULL,  -- 0-1439
  end_minute_of_day INTEGER NOT NULL,    -- 1-1440, exclusive end
  PRIMARY KEY (user_id, day_of_week, start_minute_of_day),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- A coordinator's plan for one real-world event, wrapping 1+ Car Entries (race_plans).
-- team_id is NULL for a solo driver's own weekend (no team involved). For today's
-- existing single-car flow this is a transparent wrapper created underneath race-plan
-- creation - nothing about that flow needs to look different to a solo user.
CREATE TABLE IF NOT EXISTS race_weekends (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  event_id TEXT NOT NULL,
  name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

CREATE INDEX IF NOT EXISTS idx_race_weekends_event ON race_weekends(event_id);
CREATE INDEX IF NOT EXISTS idx_race_weekends_team ON race_weekends(team_id);

ALTER TABLE race_plans ADD COLUMN race_weekend_id TEXT REFERENCES race_weekends(id);

-- Backfill: every existing race_plan becomes its own weekend-of-one-car, so nothing about
-- today's already-shipped single-plan flow changes behaviorally once wrapped.
INSERT INTO race_weekends (id, team_id, event_id, name, created_by, created_at)
SELECT 'weekend-' || id, NULL, event_id, name, created_by, created_at
FROM race_plans
WHERE race_weekend_id IS NULL;

UPDATE race_plans
SET race_weekend_id = 'weekend-' || id
WHERE race_weekend_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_race_plans_weekend ON race_plans(race_weekend_id);

-- Re-scope driver_availability from race_plan_id to race_weekend_id: a driver's
-- real-world free time doesn't depend on which car they end up in, and the multi-car
-- suggestion engine (PRD phase 6) needs one true availability picture per driver per
-- weekend to allocate across cars from. Safe 1:1 copy at migration time since every
-- race_plan has exactly one race_weekend as of the backfill above, so there's no
-- multi-plan collision to resolve yet.
CREATE TABLE driver_availability_new (
  race_weekend_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  block_start_offset_minutes INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (race_weekend_id, cust_id, block_start_offset_minutes),
  FOREIGN KEY (race_weekend_id) REFERENCES race_weekends(id)
);

INSERT INTO driver_availability_new (race_weekend_id, cust_id, block_start_offset_minutes, status, updated_at)
SELECT p.race_weekend_id, a.cust_id, a.block_start_offset_minutes, a.status, a.updated_at
FROM driver_availability a
JOIN race_plans p ON p.id = a.race_plan_id;

DROP TABLE driver_availability;
ALTER TABLE driver_availability_new RENAME TO driver_availability;

-- favorite_car preferences reuse the existing user_preferences category/value table
-- (migration 0016) rather than a new table - a driver's favorite cars are the same shape
-- as their existing racing-mode/discipline/format picks, just free-text values instead of
-- a fixed enum. No schema change needed here; see functions/api/planner/preferences.ts.
