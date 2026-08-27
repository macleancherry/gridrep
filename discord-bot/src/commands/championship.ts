import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries, resolveSeason } from "../lib/iracingLookups.ts";
import { fetchSeasonStandings } from "../lib/seasonStandings.ts";
import { buildBarChart } from "../lib/charts.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

export const championshipCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };
  const seasonQuery = optString(options, "season");

  const series = await resolveSeries(env, seriesQuery);
  const season = await resolveSeason(env, series.seriesId, seasonQuery);
  if (!season) {
    return { embeds: [{ title: series.seriesName, description: "No active season found for this series.", color: BRAND_COLOR }] };
  }

  const rows = (await fetchSeasonStandings(env, season.seasonId))
    .filter((r) => r.points != null)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const top30 = truncateList(rows, 30);

  if (top30.length === 0) {
    return { embeds: [{ title: `${series.seriesName} — championship`, description: "No standings available yet.", color: BRAND_COLOR }] };
  }

  const listing = top30
    .map((r, i) => `${i + 1}. **${r.display_name ?? `#${r.cust_id}`}** — ${r.points} pts`)
    .join("\n");

  const top10 = top30.slice(0, 10);
  const chartUrl = buildBarChart(top10.map((r) => r.display_name ?? `#${r.cust_id}`), top10.map((r) => r.points ?? 0), "Points");

  return {
    embeds: [
      {
        title: `${series.seriesName} — championship standings`,
        description: `${season.seasonName}\n\n${listing.slice(0, 3800)}`,
        color: BRAND_COLOR,
        image: { url: chartUrl },
      },
    ],
  };
};
