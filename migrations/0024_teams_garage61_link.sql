-- 0024_teams_garage61_link.sql
-- Remembers which Garage 61 team a gridrep team's roster was last imported from, so the
-- Garage 61 fuel/pit-time name-matching fallback (plannerGarage61Fuel.ts) can scope its
-- lap search to that specific team instead of every team the connecting coordinator
-- happens to belong to in Garage 61. Nullable - only ever set for teams that have actually
-- used the "Import roster from Garage 61" flow at least once; teams built by manual add
-- keep this NULL and the fallback lookup just stays as broad as it is today.

ALTER TABLE teams ADD COLUMN garage61_team_slug TEXT;
