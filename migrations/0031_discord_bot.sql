-- 0031_discord_bot.sql
--
-- Schema for the self-hosted Discord bot (discord-bot/), a clone of the
-- iRacing Reports bot: per-guild config, tracked drivers, series->channel
-- routing, league tracking, race-announcement dedup, and the bot's own
-- iRacing service-account OAuth tokens. Shares the same D1 database as the
-- main app but is otherwise independent of GridRep's props/pace/planner
-- schema.

CREATE TABLE bot_guilds (
  discord_guild_id TEXT PRIMARY KEY,
  admin_role_id TEXT,
  default_results_channel_id TEXT,
  force_channel_id TEXT,
  hide_flags INTEGER NOT NULL DEFAULT 0,
  show_license_letter INTEGER NOT NULL DEFAULT 0,
  mention_race_announcements INTEGER NOT NULL DEFAULT 0,
  announce_ir_gain_only INTEGER NOT NULL DEFAULT 0,
  announce_podium_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bot_tracked_drivers (
  guild_id TEXT NOT NULL REFERENCES bot_guilds(discord_guild_id),
  cust_id INTEGER NOT NULL,
  display_name TEXT,
  discord_user_id TEXT,
  highlight_color TEXT,
  excluded_from_announcements INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, cust_id)
);

CREATE INDEX idx_bot_tracked_drivers_guild ON bot_tracked_drivers(guild_id);

CREATE TABLE bot_series_channel_map (
  guild_id TEXT NOT NULL REFERENCES bot_guilds(discord_guild_id),
  series_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, series_id)
);

CREATE TABLE bot_leagues (
  guild_id TEXT NOT NULL REFERENCES bot_guilds(discord_guild_id),
  league_id INTEGER NOT NULL,
  name TEXT,
  default_season_id INTEGER,
  PRIMARY KEY (guild_id, league_id)
);

CREATE TABLE bot_announced_races (
  subsession_id INTEGER NOT NULL,
  cust_id INTEGER NOT NULL,
  announced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subsession_id, cust_id)
);

-- Single-row table (id always 1) holding the bot's own iRacing OAuth
-- service-account tokens, refreshed by the cron poller and reused by
-- every interaction handler.
CREATE TABLE bot_service_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
