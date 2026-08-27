import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries } from "../lib/iracingLookups.ts";
import { fetchRaceGuideSessions, buildDayHourMatrix } from "../lib/raceGuide.ts";
import { buildHeatmap } from "../lib/charts.ts";
import { BRAND_COLOR } from "../lib/format.ts";

export const officialsCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };

  const series = await resolveSeries(env, seriesQuery);
  const sessions = await fetchRaceGuideSessions(env, series.seriesId);
  if (sessions.length === 0) {
    return { embeds: [{ title: `${series.seriesName} — official session frequency`, description: "No scheduled sessions found.", color: BRAND_COLOR }] };
  }

  const { matrix, xLabels, yLabels } = buildDayHourMatrix(sessions, () => 1);
  const chartUrl = buildHeatmap(xLabels, yLabels, matrix, `${series.seriesName} — sessions by day/hour (UTC)`);

  return {
    embeds: [
      { title: `${series.seriesName} — official session frequency`, color: BRAND_COLOR, image: { url: chartUrl } },
    ],
  };
};
