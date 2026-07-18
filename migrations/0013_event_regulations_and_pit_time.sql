-- Real regulation fields confirmed live (2026-07-18 probe of "6 Hours of Road America")
-- but never captured: season-level team-size limits, and per-car fuel/tyre caps
-- (aggregated across event.car_restrictions[] since the planner has no car-selection
-- feature yet to match a specific car). series_name is stored separately from
-- iracing_events.name because select-session.ts prefers the schedule's own name (often a
-- technical slot label, e.g. "special event qual race - 22 gmt - 30 min warmup") for
-- display, but the real series name is what a pit-ruleset guess needs to match against.
ALTER TABLE iracing_events ADD COLUMN series_name TEXT;
ALTER TABLE iracing_events ADD COLUMN min_team_drivers INTEGER;
ALTER TABLE iracing_events ADD COLUMN max_team_drivers INTEGER;
ALTER TABLE iracing_events ADD COLUMN min_fuel_fill_pct INTEGER;
ALTER TABLE iracing_events ADD COLUMN max_fuel_fill_pct INTEGER;
ALTER TABLE iracing_events ADD COLUMN min_tire_sets INTEGER;
ALTER TABLE iracing_events ADD COLUMN max_tire_sets INTEGER;

-- driver_track_profiles.pit_time_seconds/pit_time_source already exist (migration 0012) -
-- scaffolded for exactly this, never populated until now. No schema change needed there.
