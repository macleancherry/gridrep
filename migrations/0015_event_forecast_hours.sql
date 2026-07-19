-- 0015_event_forecast_hours.sql
--
-- Raw hourly forecast timeline for an event, captured once at select-session time
-- alongside event_condition_profiles' bucketed Day/Dusk/Night/Dawn summaries - those
-- lose the actual shape of the forecast (a handful of min/max ranges), this keeps every
-- hour so the Conditions page can render a real visual forecast (temp curve, rain,
-- day/night) across the whole event instead of just discrete cards.
--
-- weather_url is a pre-signed, time-limited S3 link (confirmed live) - safe to fetch once
-- at select-session time when it's definitely still valid, not safe to re-fetch later.

CREATE TABLE IF NOT EXISTS event_forecast_hours (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  time_offset_minutes INTEGER NOT NULL,  -- race-start-relative, same convention as
                                          -- event_condition_profiles (negative = before green flag)
  is_sun_up INTEGER NOT NULL,            -- 0/1
  air_temp_c REAL,
  precip_chance_pct REAL,
  cloud_cover_pct REAL,
  wind_speed REAL,
  FOREIGN KEY (event_id) REFERENCES iracing_events(id)
);

CREATE INDEX IF NOT EXISTS idx_event_forecast_hours_event ON event_forecast_hours(event_id, time_offset_minutes);
