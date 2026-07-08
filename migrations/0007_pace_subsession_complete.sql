-- Tracks whether a subsession's laps have been fully ingested (no pending
-- driver/simsession pairs left), so league sync can skip already-done
-- sessions entirely instead of re-attempting them and burning subrequests.
ALTER TABLE pace_subsessions ADD COLUMN laps_complete INTEGER NOT NULL DEFAULT 0;
