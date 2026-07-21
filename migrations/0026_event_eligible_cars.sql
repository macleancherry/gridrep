-- Confirmed live (2026-07-21, /data/car/get + /data/carclass/get + season/schedule
-- payloads): schedule.car_restrictions[].car_id lists exactly which cars are enabled for
-- this specific race week, and season.car_class_ids names the real racing class(es) that
-- grouping represents (e.g. GT3 = 2708, a 3-class endurance combo = [2523,4011,4029]) -
-- distinct from iRacing's own generic "Hosted All Cars" catalog-wide class. Both stored as
-- JSON arrays (small, a handful of ids each) rather than a join table, since they're only
-- ever read back as one flat list to resolve into a picker via the cached car catalog.
-- NULL/empty for events with no car_restrictions data (most regular series) - the car
-- picker degrades to free-text in that case, same as race_plans.car_name already does.
ALTER TABLE iracing_events ADD COLUMN eligible_car_ids TEXT;
ALTER TABLE iracing_events ADD COLUMN car_class_ids TEXT;
