import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries, resolveSeason } from "../lib/iracingLookups.ts";
import { fetchSeasonStandings } from "../lib/seasonStandings.ts";
import { buildBarChart } from "../lib/charts.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

// Season standings don't expose raw lap times, so these are the closest
// proxies the Data API's aggregate endpoints offer without the bot running
// its own results-ingestion pipeline (out of scope here - see README).
const METRIC_BY_SUBCOMMAND: Record<string, { field: keyof import("../lib/seasonStandings.ts").StandingRow; label: string }> = {
  qualifying: { field: "avg_start_position", label: "Avg. start position" },
  race_average: { field: "avg_finish_position", label: "Avg. finish position" },
  race_fastest: { field: "laps_led", label: "Laps led" },
};

export const lapsCommand: CommandHandler = async (interaction, env) => {
  const { name, options } = getSubcommand(interaction.data!);
  const metric = METRIC_BY_SUBCOMMAND[name ?? ""];
  if (!metric) return { content: "Unknown /laps subcommand." };

  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };
  const seasonQuery = optString(options, "season");

  const series = await resolveSeries(env, seriesQuery);
  const season = await resolveSeason(env, series.seriesId, seasonQuery);
  if (!season) {
    return { embeds: [{ title: series.seriesName, description: "No active season found for this series.", color: BRAND_COLOR }] };
  }

  const rows = truncateList(await fetchSeasonStandings(env, season.seasonId), 15);
  const labeled = rows
    .filter((r) => r[metric.field] != null)
    .map((r) => ({ name: r.display_name ?? `#${r.cust_id}`, value: Number(r[metric.field]) }));

  if (labeled.length === 0) {
    return { embeds: [{ title: `${series.seriesName} — ${metric.label}`, description: "No pace data available yet for this season.", color: BRAND_COLOR }] };
  }

  const chartUrl = buildBarChart(labeled.map((l) => l.name), labeled.map((l) => l.value), metric.label);

  return {
    embeds: [
      {
        title: `${series.seriesName} — ${metric.label}`,
        description: season.seasonName,
        color: BRAND_COLOR,
        image: { url: chartUrl },
      },
    ],
  };
};
