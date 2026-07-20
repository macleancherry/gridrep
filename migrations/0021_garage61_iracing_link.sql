-- 0021_garage61_iracing_link.sql
--
-- Links a connected Garage 61 account back to the iRacing cust_id gridrep already keys
-- everything on. Confirmed live: GET /me/accounts on the Garage 61 API returns the
-- connecting user's own linked iRacing customer id directly ({"platform":"iracing",
-- "id":"<cust_id>",...}) - captured once at OAuth connect time (callback.ts) so driver
-- profile computation can look up "does this cust_id have a directly connected Garage 61
-- account" without re-fetching /me/accounts on every request.
ALTER TABLE garage61_oauth_tokens ADD COLUMN iracing_cust_id TEXT;

CREATE INDEX IF NOT EXISTS idx_garage61_oauth_tokens_iracing_cust_id
  ON garage61_oauth_tokens(iracing_cust_id);
