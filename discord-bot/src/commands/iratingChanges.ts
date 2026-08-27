import type { CommandHandler } from "./types.ts";
import { listTrackedDrivers } from "../lib/db.ts";
import { fetchRecentRaces } from "../lib/iracingLookups.ts";
import { filterLastNDays } from "../lib/weekWindow.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

export const iratingChangesCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const drivers = truncateList(await listTrackedDrivers(env.DB, guildId), 25);
  if (drivers.length === 0) {
    return { embeds: [{ description: "No tracked drivers yet - add some with `/manage_team add`.", color: BRAND_COLOR }] };
  }

  const rows = await Promise.all(
    drivers.map(async (d) => {
      const races = filterLastNDays(await fetchRecentRaces(env, d.cust_id).catch(() => []), 7);
      const delta = races.reduce((sum: number, r: any) => sum + ((r.newi_rating ?? 0) - (r.oldi_rating ?? 0)), 0);
      return { name: d.display_name ?? `#${d.cust_id}`, delta, races: races.length };
    })
  );
  rows.sort((a, b) => b.delta - a.delta);

  return {
    embeds: [
      {
        title: "Weekly iRating changes",
        description: rows.map((r) => `**${r.name}**: ${r.delta >= 0 ? "+" : ""}${r.delta} (${r.races} race${r.races === 1 ? "" : "s"})`).join("\n"),
        color: BRAND_COLOR,
      },
    ],
  };
};
