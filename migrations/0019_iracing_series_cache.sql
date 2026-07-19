-- 0019_iracing_series_cache.sql
--
-- Read-through cache for iRacing's season/series catalog (/data/series/seasons). This
-- payload is the same for every viewer (a public season catalog, not personalized), so
-- one shared row serves the whole team instead of every page load paying for a live
-- two-hop iRacing fetch (meta call -> signed S3 link -> the actual payload) plus an OAuth
-- token refresh check. Refreshed on-demand by whichever request finds it missing/stale
-- (see getCachedSeasonList in plannerIracing.ts) - no cron trigger or dedicated service
-- token needed, and a live-fetch failure can fall back to serving the last-known payload
-- rather than erroring the whole page out.
CREATE TABLE IF NOT EXISTS iracing_series_cache (
  id TEXT PRIMARY KEY,          -- always 'season_list' - one shared row
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
