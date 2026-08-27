import type { DiscordEmbed } from "../lib/discordApi.ts";
import type { TrackedDriver, BotGuild } from "../lib/db.ts";
import { BRAND_COLOR, iratingDeltaText, srDeltaText, ordinal } from "../lib/format.ts";

export function buildAnnouncementEmbed(race: any, driver: TrackedDriver, guild: BotGuild): { content?: string; embed: DiscordEmbed } {
  const pos = race.finish_position != null ? ordinal(race.finish_position + 1) : "—";
  const series = race.series_name ?? race.series_short_name ?? "Series";
  const track = race.track?.track_name ?? race.track_name ?? "";
  const car = race.car_name ?? "";

  const mention = guild.mention_race_announcements && driver.discord_user_id && !driver.excluded_from_announcements
    ? `<@${driver.discord_user_id}> `
    : "";

  const embed: DiscordEmbed = {
    title: `${driver.display_name ?? `Driver ${driver.cust_id}`} — ${pos} in ${series}`,
    url: race.subsession_id ? `https://members.iracing.com/membersite/member/EventResult.do?subsessionid=${race.subsession_id}` : undefined,
    color: driver.highlight_color ? parseInt(driver.highlight_color.replace("#", ""), 16) || BRAND_COLOR : BRAND_COLOR,
    fields: [
      { name: "Track", value: track || "—", inline: true },
      { name: "Car", value: car || "—", inline: true },
      { name: "iRating", value: iratingDeltaText(race.oldi_rating, race.newi_rating), inline: true },
      { name: "Safety Rating", value: srDeltaText(race.old_sub_level, race.new_sub_level), inline: true },
      { name: "Incidents", value: String(race.incidents ?? 0), inline: true },
    ],
    timestamp: race.start_time,
  };

  return { content: mention || undefined, embed };
}

export function passesAnnouncementFilters(race: any, guild: BotGuild): boolean {
  if (guild.announce_ir_gain_only && !((race.newi_rating ?? 0) > (race.oldi_rating ?? 0))) return false;
  if (guild.announce_podium_only && !((race.finish_position ?? 99) <= 2)) return false;
  return true;
}
