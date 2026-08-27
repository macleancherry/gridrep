import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveSeries } from "../lib/iracingLookups.ts";
import { iracingGet } from "../lib/iracingAuth.ts";
import { BRAND_COLOR } from "../lib/format.ts";

export const scheduleCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const seriesQuery = optString(options, "series");
  if (!seriesQuery) return { content: "A series is required." };
  const seasonQuery = optString(options, "season");

  const series = await resolveSeries(env, seriesQuery);
  const data: any = await iracingGet(env, "/data/series/seasons?include_series=true");
  const list: any[] = Array.isArray(data) ? data : (data?.seasons ?? []);
  const seasonsForSeries = list.filter((s) => s.series_id === series.seriesId);

  const season = seasonQuery
    ? (seasonsForSeries.find((s) => String(s.season_id) === seasonQuery.trim()) ?? seasonsForSeries.find((s) => s.active))
    : seasonsForSeries.find((s) => s.active);

  if (!season) {
    return { embeds: [{ title: series.seriesName, description: "No active season found for this series.", color: BRAND_COLOR }] };
  }

  const schedules: any[] = season.schedules ?? [];
  if (schedules.length === 0) {
    return { embeds: [{ title: `${series.seriesName} — schedule`, description: "No schedule data available for this season.", color: BRAND_COLOR }] };
  }

  const lines = schedules
    .sort((a, b) => (a.race_week_num ?? 0) - (b.race_week_num ?? 0))
    .map((w) => {
      const track = w.track?.track_name ?? w.track_name ?? "TBD";
      const config = w.track?.config_name ?? w.config_name;
      return `Week ${(w.race_week_num ?? 0) + 1}: **${track}**${config && config !== "N/A" ? ` (${config})` : ""}`;
    });

  return {
    embeds: [
      {
        title: `${series.seriesName} — track rotation`,
        description: `${season.season_name ?? "Current season"}\n\n${lines.join("\n").slice(0, 3900)}`,
        color: BRAND_COLOR,
      },
    ],
  };
};
