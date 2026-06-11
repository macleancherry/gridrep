-- Add iRating and license class to driver profiles
ALTER TABLE drivers ADD COLUMN irating INTEGER;
ALTER TABLE drivers ADD COLUMN license_class TEXT;
ALTER TABLE drivers ADD COLUMN irating_updated_at TEXT;

-- Add per-result iRating and license change columns
ALTER TABLE session_participants ADD COLUMN irating_change INTEGER;
ALTER TABLE session_participants ADD COLUMN license_change TEXT;
