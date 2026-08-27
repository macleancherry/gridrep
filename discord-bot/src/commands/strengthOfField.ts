import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries } from "../lib/iracingLookups.ts";
import { fetchRaceGuideSessions } from "../lib/raceGuide.ts";
import { buildHeatmap } from "../lib/charts.ts";
import { BRAND_COLOR } from "../lib/format.ts";

export const strengthOfFieldCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };

  const series = await resolveSeries(env, seriesQuery);
  const sessions = (await fetchRaceGuideSessions(env, series.seriesId)).filter((s) => s.strength_of_field != null);
  if (sessions.length === 0) {
    return { embeds: [{ title: `${series.seriesName} — strength of field`, description: "No SoF data available for scheduled sessions.", color: BRAND_COLOR }] };
  }

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}:00`);
  const sums = DAY_LABELS.map(() => HOUR_LABELS.map(() => 0));
  const counts = DAY_LABELS.map(() => HOUR_LABELS.map(() => 0));

  for (const s of sessions) {
    const d = new Date(s.start_time!);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    sums[day][hour] += s.strength_of_field ?? 0;
    counts[day][hour] += 1;
  }

  const matrix = sums.map((row, y) => row.map((sum, x) => (counts[y][x] ? Math.round(sum / counts[y][x]) : 0)));
  const chartUrl = buildHeatmap(HOUR_LABELS, DAY_LABELS, matrix, `${series.seriesName} — avg strength of field by day/hour (UTC)`);

  return {
    embeds: [{ title: `${series.seriesName} — strength of field`, color: BRAND_COLOR, image: { url: chartUrl } }],
  };
};
