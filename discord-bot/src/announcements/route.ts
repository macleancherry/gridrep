import type { BotGuild } from "../lib/db.ts";
import { listSeriesChannels } from "../lib/db.ts";

/** Series-specific channel mapping first, else the guild's default results channel. */
export async function resolveAnnouncementChannel(db: D1Database, guild: BotGuild, seriesId: number | undefined): Promise<string | null> {
  if (seriesId != null) {
    const mappings = await listSeriesChannels(db, guild.discord_guild_id);
    const match = mappings.find((m) => m.series_id === seriesId);
    if (match) return match.channel_id;
  }
  return guild.default_results_channel_id;
}
