-- Captures each driver's car for a given lap (confirmed live: session_results[].results[]
-- and .driver_results[] both carry car_id per driver, ingestion previously discarded it -
-- the same payload plannerIracing.ts already fetches for participant/team extraction).
-- Needed so pace can be scoped per car, not just per track.
ALTER TABLE planner_iracing_laps ADD COLUMN car_id INTEGER;

-- driver_track_profiles.id stays a deterministic string, now car-scoped
-- (cust_id:track_name:carId:conditionProfileId, "none" when no car is selected on the
-- plan yet - matches today's un-car-scoped behavior exactly for any plan that never picks
-- one). The car_id column itself is for querying/filtering, same role pace_source plays
-- alongside the id.
ALTER TABLE driver_track_profiles ADD COLUMN car_id INTEGER;

-- Per-plan lock (deliberately NOT on the shared driver_track_profiles cache - a lock only
-- applies to this one race, per the coordinator's explicit choice; a different race reusing
-- the same driver+track+car keeps auto-syncing normally). locked_at set means: use
-- locked_pace_ms/locked_fuel_per_lap for this driver in this plan, and skip any further
-- auto-resync attempt for them here. NULL locked_at (the default) means unlocked - normal
-- auto-sync/race-default fallback applies.
ALTER TABLE race_plan_lineup ADD COLUMN locked_pace_ms INTEGER;
ALTER TABLE race_plan_lineup ADD COLUMN locked_fuel_per_lap REAL;
ALTER TABLE race_plan_lineup ADD COLUMN locked_at TEXT;
