-- 0017_driver_condition_preferences.sql
--
-- Standing per-driver condition preferences (night/wet/race-start) - distinct from
-- user_preferences (0016), which is about which *events* to search for, not what kind
-- of stint a driver wants within one. Carries across every plan the driver's on, same
-- as the onboarding preferences. Used to annotate the Availability page's block grid so
-- a driver (and eventually the person assigning stints) can see at a glance which of
-- their free blocks line up with what they actually want to drive.

CREATE TABLE IF NOT EXISTS driver_condition_preferences (
  user_id TEXT PRIMARY KEY,
  night_preference TEXT NOT NULL DEFAULT 'neutral',  -- 'prefer' | 'neutral' | 'avoid'
  wet_preference TEXT NOT NULL DEFAULT 'neutral',
  start_preference TEXT NOT NULL DEFAULT 'neutral',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
