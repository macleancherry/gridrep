-- 0020_driver_recent_session_search.sql
--
-- Background lap-discovery status (vision: "by the time the organiser gets to this page
-- there is already information available"). Keyed by (cust_id, track_name), not by plan -
-- same global-cache philosophy as driver_track_profiles/planner_iracing_laps, since two
-- different plans for the same track share the exact same answer to "does this driver
-- have recent laps here". Lets the Lineup page poll progress and lets the trigger point
-- (race-plans/:planId/lineup PUT) avoid kicking off a redundant duplicate search for a
-- driver who's already searching, found, or came back empty.
CREATE TABLE IF NOT EXISTS driver_recent_session_search (
  cust_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  status TEXT NOT NULL,            -- 'searching' | 'found' | 'not_found' | 'error'
  subsession_id TEXT,
  message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cust_id, track_name)
);
