import type { CommandHandler } from "./types.ts";
import { listTrackedDrivers } from "../lib/db.ts";
import { fetchRecentRaces } from "../lib/iracingLookups.ts";
import { filterLastNDays } from "../lib/weekWindow.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

export const weekCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const drivers = truncateList(await listTrackedDrivers(env.DB, guildId), 25);
  if (drivers.length === 0) {
    return { embeds: [{ description: "No tracked drivers yet - add some with `/manage_team add`.", color: BRAND_COLOR }] };
  }

  const rows = await Promise.all(
    drivers.map(async (d) => {
      const races = filterLastNDays(await fetchRecentRaces(env, d.cust_id).catch(() => []), 7);
      const points = races.reduce((sum: number, r: any) => sum + (r.champ_points ?? r.points ?? 0), 0);
      const wins = races.filter((r: any) => r.finish_position === 0).length;
      return { name: d.display_name ?? `#${d.cust_id}`, races: races.length, points, wins };
    })
  );
  rows.sort((a, b) => b.races - a.races || b.points - a.points);

  return {
    embeds: [
      {
        title: "This week's team activity",
        description: rows.map((r) => `**${r.name}**: ${r.races} race${r.races === 1 ? "" : "s"}, ${r.points} pts, ${r.wins} win${r.wins === 1 ? "" : "s"}`).join("\n"),
        color: BRAND_COLOR,
      },
    ],
  };
};
