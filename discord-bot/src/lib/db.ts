export type BotGuild = {
  discord_guild_id: string;
  admin_role_id: string | null;
  default_results_channel_id: string | null;
  force_channel_id: string | null;
  hide_flags: number;
  show_license_letter: number;
  mention_race_announcements: number;
  announce_ir_gain_only: number;
  announce_podium_only: number;
};

export type TrackedDriver = {
  guild_id: string;
  cust_id: number;
  display_name: string | null;
  discord_user_id: string | null;
  highlight_color: string | null;
  excluded_from_announcements: number;
};

export async function ensureGuild(db: D1Database, guildId: string): Promise<BotGuild> {
  await db
    .prepare("INSERT INTO bot_guilds (discord_guild_id) VALUES (?) ON CONFLICT(discord_guild_id) DO NOTHING")
    .bind(guildId)
    .run();
  const row = await db
    .prepare("SELECT * FROM bot_guilds WHERE discord_guild_id = ?")
    .bind(guildId)
    .first<BotGuild>();
  if (!row) throw new Error(`Failed to load/create guild ${guildId}`);
  return row;
}

export async function updateGuild(db: D1Database, guildId: string, fields: Partial<Omit<BotGuild, "discord_guild_id">>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  await ensureGuild(db, guildId);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (fields as Record<string, unknown>)[k]);
  await db
    .prepare(`UPDATE bot_guilds SET ${setClause}, updated_at = datetime('now') WHERE discord_guild_id = ?`)
    .bind(...values, guildId)
    .run();
}

export async function listTrackedDrivers(db: D1Database, guildId: string): Promise<TrackedDriver[]> {
  const res = await db
    .prepare("SELECT * FROM bot_tracked_drivers WHERE guild_id = ? ORDER BY display_name, cust_id")
    .bind(guildId)
    .all<TrackedDriver>();
  return res.results ?? [];
}

export async function addTrackedDriver(
  db: D1Database,
  guildId: string,
  custId: number,
  opts: { displayName?: string | null; discordUserId?: string | null } = {}
): Promise<void> {
  await ensureGuild(db, guildId);
  await db
    .prepare(
      `INSERT INTO bot_tracked_drivers (guild_id, cust_id, display_name, discord_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, cust_id) DO UPDATE SET display_name = excluded.display_name, discord_user_id = excluded.discord_user_id`
    )
    .bind(guildId, custId, opts.displayName ?? null, opts.discordUserId ?? null)
    .run();
}

export async function removeTrackedDriver(db: D1Database, guildId: string, custId: number): Promise<void> {
  await db
    .prepare("DELETE FROM bot_tracked_drivers WHERE guild_id = ? AND cust_id = ?")
    .bind(guildId, custId)
    .run();
}

export async function updateTrackedDriver(
  db: D1Database,
  guildId: string,
  custId: number,
  fields: Partial<Pick<TrackedDriver, "highlight_color" | "discord_user_id" | "excluded_from_announcements">>
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (fields as Record<string, unknown>)[k]);
  await db
    .prepare(`UPDATE bot_tracked_drivers SET ${setClause} WHERE guild_id = ? AND cust_id = ?`)
    .bind(...values, guildId, custId)
    .run();
}

export async function setSeriesChannel(db: D1Database, guildId: string, seriesId: number, channelId: string): Promise<void> {
  await ensureGuild(db, guildId);
  await db
    .prepare(
      `INSERT INTO bot_series_channel_map (guild_id, series_id, channel_id) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, series_id) DO UPDATE SET channel_id = excluded.channel_id`
    )
    .bind(guildId, seriesId, channelId)
    .run();
}

export async function removeSeriesChannel(db: D1Database, guildId: string, seriesId: number): Promise<void> {
  await db
    .prepare("DELETE FROM bot_series_channel_map WHERE guild_id = ? AND series_id = ?")
    .bind(guildId, seriesId)
    .run();
}

export async function listSeriesChannels(db: D1Database, guildId: string): Promise<{ series_id: number; channel_id: string }[]> {
  const res = await db
    .prepare("SELECT series_id, channel_id FROM bot_series_channel_map WHERE guild_id = ? ORDER BY series_id")
    .bind(guildId)
    .all<{ series_id: number; channel_id: string }>();
  return res.results ?? [];
}

export async function setLeague(db: D1Database, guildId: string, leagueId: number, name: string | null): Promise<void> {
  await ensureGuild(db, guildId);
  await db
    .prepare(
      `INSERT INTO bot_leagues (guild_id, league_id, name) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, league_id) DO UPDATE SET name = excluded.name`
    )
    .bind(guildId, leagueId, name)
    .run();
}

export async function setLeagueDefaultSeason(db: D1Database, guildId: string, leagueId: number, seasonId: number): Promise<void> {
  await db
    .prepare("UPDATE bot_leagues SET default_season_id = ? WHERE guild_id = ? AND league_id = ?")
    .bind(seasonId, guildId, leagueId)
    .run();
}

export async function removeLeague(db: D1Database, guildId: string, leagueId: number): Promise<void> {
  await db.prepare("DELETE FROM bot_leagues WHERE guild_id = ? AND league_id = ?").bind(guildId, leagueId).run();
}

export type BotLeague = { guild_id: string; league_id: number; name: string | null; default_season_id: number | null };

export async function getLeague(db: D1Database, guildId: string, leagueId: number): Promise<BotLeague | null> {
  const row = await db
    .prepare("SELECT * FROM bot_leagues WHERE guild_id = ? AND league_id = ?")
    .bind(guildId, leagueId)
    .first<BotLeague>();
  return row ?? null;
}

/** Guilds typically track one league; commands that don't take an explicit league_id use this one. */
export async function getDefaultLeague(db: D1Database, guildId: string): Promise<BotLeague | null> {
  const row = await db
    .prepare("SELECT * FROM bot_leagues WHERE guild_id = ? ORDER BY league_id LIMIT 1")
    .bind(guildId)
    .first<BotLeague>();
  return row ?? null;
}

/** Returns the subset of subsession_ids not yet announced for cust_id. */
export async function filterUnannounced(db: D1Database, custId: number, subsessionIds: number[]): Promise<number[]> {
  if (subsessionIds.length === 0) return [];
  const placeholders = subsessionIds.map(() => "?").join(", ");
  const res = await db
    .prepare(`SELECT subsession_id FROM bot_announced_races WHERE cust_id = ? AND subsession_id IN (${placeholders})`)
    .bind(custId, ...subsessionIds)
    .all<{ subsession_id: number }>();
  const already = new Set((res.results ?? []).map((r) => r.subsession_id));
  return subsessionIds.filter((id) => !already.has(id));
}

export async function markAnnounced(db: D1Database, custId: number, subsessionId: number): Promise<void> {
  await db
    .prepare("INSERT INTO bot_announced_races (subsession_id, cust_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .bind(subsessionId, custId)
    .run();
}

export async function listGuildIds(db: D1Database): Promise<string[]> {
  const res = await db.prepare("SELECT discord_guild_id FROM bot_guilds").all<{ discord_guild_id: string }>();
  return (res.results ?? []).map((r) => r.discord_guild_id);
}
