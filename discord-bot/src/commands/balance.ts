import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries, resolveSeason } from "../lib/iracingLookups.ts";
import { fetchSeasonCarClasses, fetchSeasonStandings } from "../lib/seasonStandings.ts";
import { buildBarChart } from "../lib/charts.ts";
import { BRAND_COLOR } from "../lib/format.ts";

export const balanceCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };

  const series = await resolveSeries(env, seriesQuery);
  const season = await resolveSeason(env, series.seriesId);
  if (!season) {
    return { embeds: [{ title: series.seriesName, description: "No active season found for this series.", color: BRAND_COLOR }] };
  }

  const carClasses = await fetchSeasonCarClasses(env, season.seasonId);
  if (carClasses.length < 2) {
    return {
      embeds: [
        { title: `${series.seriesName} — car balance`, description: "This series has a single car class - no cross-car comparison to show.", color: BRAND_COLOR },
      ],
    };
  }

  const perClass = await Promise.all(
    carClasses.map(async (c) => {
      const rows = await fetchSeasonStandings(env, season.seasonId, c.carClassId).catch(() => []);
      const avgPoints = rows.length ? rows.reduce((sum, r) => sum + (r.points ?? 0), 0) / rows.length : 0;
      return { name: c.name, avgPoints, entries: rows.length };
    })
  );

  const chartUrl = buildBarChart(perClass.map((c) => c.name), perClass.map((c) => Math.round(c.avgPoints)), "Avg. championship points");

  return {
    embeds: [
      {
        title: `${series.seriesName} — car class balance`,
        description: `${season.seasonName}\n` + perClass.map((c) => `**${c.name}**: ${c.entries} drivers, ${Math.round(c.avgPoints)} avg pts`).join("\n"),
        color: BRAND_COLOR,
        image: { url: chartUrl },
      },
    ],
  };
};
