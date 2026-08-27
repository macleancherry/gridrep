import type { BotEnv } from "../lib/iracingAuth.ts";
import { ensureGuild, listGuildIds, listTrackedDrivers, filterUnannounced, markAnnounced } from "../lib/db.ts";
import { fetchRecentRaces } from "../lib/iracingLookups.ts";
import { postChannelMessage } from "../lib/discordApi.ts";
import { resolveAnnouncementChannel } from "./route.ts";
import { buildAnnouncementEmbed, passesAnnouncementFilters } from "./format.ts";

export type AnnouncementEnv = BotEnv & { DISCORD_BOT_TOKEN: string };

/**
 * Cron entrypoint: for every guild's tracked drivers, find race finishes
 * that haven't been announced yet and post them to the routed channel.
 */
export async function pollAndAnnounce(env: AnnouncementEnv): Promise<void> {
  const guildIds = await listGuildIds(env.DB);

  for (const guildId of guildIds) {
    const guild = await ensureGuild(env.DB, guildId);
    const drivers = await listTrackedDrivers(env.DB, guildId);

    for (const driver of drivers) {
      let races: any[];
      try {
        races = await fetchRecentRaces(env, driver.cust_id);
      } catch (err) {
        console.error(`Failed to fetch recent races for cust_id=${driver.cust_id}`, err);
        continue;
      }

      const subsessionIds = races.map((r) => r.subsession_id).filter((id): id is number => typeof id === "number");
      const unannounced = await filterUnannounced(env.DB, driver.cust_id, subsessionIds);
      if (unannounced.length === 0) continue;

      for (const subsessionId of unannounced) {
        const race = races.find((r) => r.subsession_id === subsessionId);
        if (!race) continue;

        // Mark announced up front so a transient post failure doesn't
        // retry-storm on the next cron tick; the race stays visible via
        // /previous_race regardless.
        await markAnnounced(env.DB, driver.cust_id, subsessionId);

        if (driver.excluded_from_announcements) continue;
        if (!passesAnnouncementFilters(race, guild)) continue;

        const channelId = await resolveAnnouncementChannel(env.DB, guild, race.series_id);
        if (!channelId) continue;

        try {
          const { content, embed } = buildAnnouncementEmbed(race, driver, guild);
          await postChannelMessage(env.DISCORD_BOT_TOKEN, channelId, { content, embeds: [embed] });
        } catch (err) {
          console.error(`Failed to post announcement for cust_id=${driver.cust_id} subsession=${subsessionId}`, err);
        }
      }
    }
  }
}
