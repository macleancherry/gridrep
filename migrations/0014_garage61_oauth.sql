-- 0014_garage61_oauth.sql
--
-- Per-driver Garage 61 OAuth tokens, mirroring oauth_tokens (0002_auth.sql) but as a
-- second, independent provider - a gridrep user may or may not have connected Garage 61,
-- separate from their required iRacing sign-in.

CREATE TABLE IF NOT EXISTS garage61_oauth_tokens (
  user_id TEXT PRIMARY KEY,
  garage61_user_id TEXT NOT NULL,
  garage61_slug TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  access_expires_at TEXT,       -- ISO timestamp
  scope TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
