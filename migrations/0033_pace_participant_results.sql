-- Extend pace_participants (added in 0032 for the official incidents total)
-- with the rest of the per-driver fields iRacing's own result payload
-- already carries on the same row: starting/finish position, car/class,
-- and iRating change - all read once during ingest, none require any
-- extra API calls.
ALTER TABLE pace_participants ADD COLUMN start_pos INTEGER;
ALTER TABLE pace_participants ADD COLUMN finish_pos INTEGER;
ALTER TABLE pace_participants ADD COLUMN car_name TEXT;
ALTER TABLE pace_participants ADD COLUMN car_class TEXT;
ALTER TABLE pace_participants ADD COLUMN irating_change INTEGER;
