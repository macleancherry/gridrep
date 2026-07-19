-- 0016_user_preferences.sql
--
-- Onboarding preference wizard: racing mode (solo/team), discipline (road/oval/dirt
-- road/dirt oval), and format (sprint/endurance/special) - each multi-select, used to
-- tailor event search results. category/value rather than fixed columns since every
-- question is multi-select (a driver can race both solo and team, multiple disciplines).

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,   -- 'racing_mode' | 'discipline' | 'format'
  value TEXT NOT NULL,      -- e.g. 'solo' | 'team'; 'road' | 'oval' | 'dirt_road' | 'dirt_oval'; 'sprint' | 'endurance' | 'special'
  PRIMARY KEY (user_id, category, value),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;
