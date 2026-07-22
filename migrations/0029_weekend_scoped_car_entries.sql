-- 0029_weekend_scoped_car_entries.sql
--
-- Coordinator navigation rebuild (PLAN: "Coordinator navigation rebuild - Teams / Race
-- Weekends / Plans / Live", 2026-07-22): each Car Entry in a Race Weekend can now pick its
-- own race independently ("car one might run one race, car two a completely different
-- race") instead of every car in a weekend being forced onto one shared event. That means
-- both a Car Entry and a Race Weekend now need to be representable with no event chosen
-- yet (a coordinator creates a blank weekend, adds a car, picks that car's race
-- afterward) - SQLite has no ALTER COLUMN, so both tables are rebuilt with event_id made
-- nullable, same CREATE-new/copy/DROP/RENAME technique migration 0022 already used.
--
-- It also reverses one piece of that same migration 0022: driver_availability moves back
-- from race_weekend_id-scoped to race_plan_id-scoped. 0022 scoped it to the weekend on the
-- assumption that every car in a weekend shares one green-flag time - an assumption this
-- migration removes, so one shared availability row per weekend is now provably ambiguous
-- the moment two cars in a weekend run different events.
--
-- Every table that declares a live FOREIGN KEY against race_plans or race_weekends has to
-- be rebuilt WITHOUT that declaration before either parent table's own DROP TABLE step -
-- confirmed empirically in this environment that `PRAGMA foreign_keys = OFF` does not
-- suppress D1/SQLite's "table is still referenced" check on DROP TABLE, so the only
-- reliable fix is removing the declaring FK ahead of time. None of these four tables
-- change shape otherwise; referential integrity for all of them is already enforced in
-- application code (cascadeDeleteRacePlan/cascadeDeleteRaceWeekend in
-- functions/_lib/plannerRacePlan.ts), same as several other tables in this schema.

-- race_plan_lineup: unchanged columns, FK to race_plans dropped (see header note).
CREATE TABLE race_plan_lineup_new (
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  locked_pace_ms INTEGER,
  locked_fuel_per_lap REAL,
  locked_at TEXT,
  PRIMARY KEY (race_plan_id, cust_id)
);
INSERT INTO race_plan_lineup_new SELECT race_plan_id, cust_id, locked_pace_ms, locked_fuel_per_lap, locked_at FROM race_plan_lineup;
DROP TABLE race_plan_lineup;
ALTER TABLE race_plan_lineup_new RENAME TO race_plan_lineup;

-- race_plan_stints: unchanged columns, FK to race_plans dropped.
CREATE TABLE race_plan_stints_new (
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
  fuel_warning INTEGER NOT NULL DEFAULT 0
);
INSERT INTO race_plan_stints_new
SELECT id, race_plan_id, stint_order, cust_id, lap_count, pace_ms, fuel_per_lap, start_offset_minutes,
       duration_minutes, fuel_load_liters, pit_target_offset_minutes, fuel_warning
FROM race_plan_stints;
DROP TABLE race_plan_stints;
ALTER TABLE race_plan_stints_new RENAME TO race_plan_stints;
CREATE INDEX IF NOT EXISTS idx_race_plan_stints_plan ON race_plan_stints (race_plan_id, stint_order);

-- race_plan_duty_assignments: unchanged columns, FK to race_plans dropped.
CREATE TABLE race_plan_duty_assignments_new (
  id TEXT PRIMARY KEY,
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'spotting',
  start_time_offset_minutes REAL NOT NULL,
  end_time_offset_minutes REAL NOT NULL
);
INSERT INTO race_plan_duty_assignments_new
SELECT id, race_plan_id, cust_id, role, start_time_offset_minutes, end_time_offset_minutes
FROM race_plan_duty_assignments;
DROP TABLE race_plan_duty_assignments;
ALTER TABLE race_plan_duty_assignments_new RENAME TO race_plan_duty_assignments;
CREATE INDEX IF NOT EXISTS idx_duty_assignments_plan ON race_plan_duty_assignments (race_plan_id);

-- race_weekend_participants: unchanged columns, FK to race_weekends dropped.
CREATE TABLE race_weekend_participants_new (
  race_weekend_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  PRIMARY KEY (race_weekend_id, cust_id)
);
INSERT INTO race_weekend_participants_new SELECT race_weekend_id, cust_id FROM race_weekend_participants;
DROP TABLE race_weekend_participants;
ALTER TABLE race_weekend_participants_new RENAME TO race_weekend_participants;

-- driver_availability: re-scoped from race_weekend_id back to race_plan_id (reversing
-- migration 0022's own rescoping) in the same step as dropping its FK to race_weekends.
-- For a weekend with exactly one car (the overwhelming majority - every solo/single-car
-- flow, unchanged), the copy is a direct, unambiguous 1:1 mapping. For a weekend with 2+
-- cars (today's rarer, already-existing multi-car weekends), there's no way to know after
-- the fact which car a stored row "really" belonged to - rather than guess or drop real
-- submitted data, it's duplicated onto every car in that weekend; a driver's
-- already-submitted availability reappears prefilled on every one of that weekend's cars
-- and can be adjusted per car from there.
CREATE TABLE driver_availability_new (
  race_plan_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  block_start_offset_minutes INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (race_plan_id, cust_id, block_start_offset_minutes)
);
INSERT INTO driver_availability_new (race_plan_id, cust_id, block_start_offset_minutes, status, updated_at)
SELECT p.id, a.cust_id, a.block_start_offset_minutes, a.status, a.updated_at
FROM driver_availability a
JOIN race_plans p ON p.race_weekend_id = a.race_weekend_id;
DROP TABLE driver_availability;
ALTER TABLE driver_availability_new RENAME TO driver_availability;
CREATE INDEX IF NOT EXISTS idx_driver_availability_cust ON driver_availability(cust_id);

-- race_plans: event_id becomes nullable. Every other column carried over verbatim,
-- including `id`, so every child table's race_plan_id value (now an unconstrained plain
-- column on every child above) stays meaningful untouched. race_weekend_id is likewise
-- left as a plain column, not a declared FK - race_weekends is rebuilt next in this same
-- migration, so a live FK against it here would hit the identical DROP TABLE problem this
-- migration exists to avoid.
CREATE TABLE race_plans_new (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  name TEXT,
  car_name TEXT,
  fuel_tank_capacity_liters REAL,
  pit_stop_seconds INTEGER NOT NULL DEFAULT 55,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  time_slot_id TEXT REFERENCES race_plan_time_slots(id),
  availability_block_minutes INTEGER NOT NULL DEFAULT 60,
  race_duration_minutes INTEGER,
  fatigue_threshold_minutes INTEGER NOT NULL DEFAULT 120,
  car_id INTEGER,
  car_class_id INTEGER,
  default_pace_ms INTEGER,
  default_fuel_per_lap REAL,
  race_weekend_id TEXT,
  live_subsession_id TEXT,
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

INSERT INTO race_plans_new
SELECT id, event_id, name, car_name, fuel_tank_capacity_liters, pit_stop_seconds, created_by,
       created_at, updated_at, time_slot_id, availability_block_minutes, race_duration_minutes,
       fatigue_threshold_minutes, car_id, car_class_id, default_pace_ms, default_fuel_per_lap,
       race_weekend_id, live_subsession_id
FROM race_plans;

DROP TABLE race_plans;
ALTER TABLE race_plans_new RENAME TO race_plans;

CREATE INDEX IF NOT EXISTS idx_race_plans_event ON race_plans (event_id);
CREATE INDEX IF NOT EXISTS idx_race_plans_weekend ON race_plans(race_weekend_id);

-- race_weekends: event_id becomes nullable (a brand-new weekend has no event at all until
-- its first car picks one - there's no longer one "the weekend's event" to store up front).
CREATE TABLE race_weekends_new (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  event_id TEXT,
  name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

INSERT INTO race_weekends_new SELECT id, team_id, event_id, name, created_by, created_at FROM race_weekends;

DROP TABLE race_weekends;
ALTER TABLE race_weekends_new RENAME TO race_weekends;

CREATE INDEX IF NOT EXISTS idx_race_weekends_event ON race_weekends(event_id);
CREATE INDEX IF NOT EXISTS idx_race_weekends_team ON race_weekends(team_id);
