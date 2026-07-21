-- Fuel already has a manual-entry fallback (fuel_source = 'manual') for when no real data
-- exists yet. Pace never had an equivalent - a driver with no synced clean laps at a track
-- had no way to unblock Stints' pace+fuel readiness gate at all, since only fuel could be
-- manually supplied. This adds the same fallback for pace.
ALTER TABLE driver_track_profiles ADD COLUMN pace_source TEXT; -- 'computed' | 'manual'
