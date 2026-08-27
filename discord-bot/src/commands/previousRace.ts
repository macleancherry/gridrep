import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveDriver, fetchRecentRaces } from "../lib/iracingLookups.ts";
import { BRAND_COLOR, iratingDeltaText, srDeltaText, ordinal, truncateList } from "../lib/format.ts";

function raceLine(race: any): string {
  const pos = race.finish_position != null ? ordinal(race.finish_position + 1) : "—";
  const series = race.series_name ?? race.series_short_name ?? "Series";
  const track = race.track?.track_name ?? race.track_name ?? "";
  const ir = iratingDeltaText(race.oldi_rating, race.newi_rating);
  const sr = srDeltaText(race.old_sub_level, race.new_sub_level);
  return `**${series}** at ${track} — ${pos}, iR ${ir}, SR ${sr}, ${race.incidents ?? 0}x`;
}

export const previousRaceCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const query = optString(options, "driver");
  if (!query) return { content: "A driver is required." };

  const driver = await resolveDriver(env, query);
  const races = await fetchRecentRaces(env, driver.custId);
  const latest = races[0];
  if (!latest) {
    return { embeds: [{ title: driver.displayName, description: "No recent races found.", color: BRAND_COLOR }] };
  }

  return {
    embeds: [
      {
        title: driver.displayName,
        description: raceLine(latest),
        url: latest.subsession_id
          ? `https://members.iracing.com/membersite/member/EventResult.do?subsessionid=${latest.subsession_id}`
          : undefined,
        color: BRAND_COLOR,
      },
    ],
  };
};

export const previousRacesCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const query = optString(options, "driver");
  if (!query) return { content: "A driver is required." };

  const driver = await resolveDriver(env, query);
  const races = truncateList(await fetchRecentRaces(env, driver.custId), 10);
  if (races.length === 0) {
    return { embeds: [{ title: driver.displayName, description: "No recent races found.", color: BRAND_COLOR }] };
  }

  return {
    embeds: [
      {
        title: `${driver.displayName} — last ${races.length} races`,
        description: races.map(raceLine).join("\n"),
        color: BRAND_COLOR,
      },
    ],
  };
};
