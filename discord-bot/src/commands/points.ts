import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { listTrackedDrivers } from "../lib/db.ts";
import { fetchRecentRaces } from "../lib/iracingLookups.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

export const pointsCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const { options } = getSubcommand(interaction.data!);
  const seriesFilter = optString(options, "series")?.toLowerCase();

  const drivers = truncateList(await listTrackedDrivers(env.DB, guildId), 25);
  if (drivers.length === 0) {
    return { embeds: [{ description: "No tracked drivers yet - add some with `/manage_team add`.", color: BRAND_COLOR }] };
  }

  const rows = await Promise.all(
    drivers.map(async (d) => {
      let races = await fetchRecentRaces(env, d.cust_id).catch(() => []);
      if (seriesFilter) races = races.filter((r: any) => (r.series_name ?? "").toLowerCase().includes(seriesFilter));
      const points = races.reduce((sum: number, r: any) => sum + (r.champ_points ?? r.points ?? 0), 0);
      return { name: d.display_name ?? `#${d.cust_id}`, points, races: races.length };
    })
  );
  rows.sort((a, b) => b.points - a.points);

  return {
    embeds: [
      {
        title: seriesFilter ? `Championship points — ${seriesFilter}` : "Championship points (recent races)",
        description: rows.map((r) => `**${r.name}**: ${r.points} pts (${r.races} race${r.races === 1 ? "" : "s"})`).join("\n"),
        color: BRAND_COLOR,
      },
    ],
  };
};
