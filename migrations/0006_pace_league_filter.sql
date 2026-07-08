-- iRacing's /data/results/search_hosted requires a primary filter (host,
-- driver, team, or session name) alongside league_id - it can't search by
-- league_id alone. Let a followed league supply either or both.
ALTER TABLE pace_leagues ADD COLUMN host_cust_id TEXT;
ALTER TABLE pace_leagues ADD COLUMN session_name_filter TEXT;
