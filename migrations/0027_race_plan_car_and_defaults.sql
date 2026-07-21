-- race_plans.car_name already exists (free text, never wired to a picker - the long-
-- standing gap this migration closes). car_id/car_class_id are the real, resolved
-- selection once a coordinator picks from the event's eligible-car list (migration 0026);
-- car_name keeps being the display value either way (resolved name when car_id is set, or
-- the coordinator's own free text when the event has no car-eligibility data at all).
--
-- default_pace_ms/default_fuel_per_lap: a coordinator-set race-wide fallback used for any
-- driver who doesn't have their own pace/fuel yet (new driver, no synced laps, hasn't
-- practiced this car). Once a driver gets their own real (or locked-manual) data, it wins
-- over these - this is purely a stand-in so stint planning isn't blocked on every driver
-- individually.
ALTER TABLE race_plans ADD COLUMN car_id INTEGER;
ALTER TABLE race_plans ADD COLUMN car_class_id INTEGER;
ALTER TABLE race_plans ADD COLUMN default_pace_ms INTEGER;
ALTER TABLE race_plans ADD COLUMN default_fuel_per_lap REAL;
