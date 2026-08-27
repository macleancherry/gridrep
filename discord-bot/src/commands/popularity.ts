import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { fetchRaceGuideSessions } from "../lib/raceGuide.ts";
import { buildBarChart } from "../lib/charts.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

export const popularityCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const category = optString(options, "category");

  const sessions = await fetchRaceGuideSessions(env);
  const bySeries = new Map<string, number>();
  for (const s of sessions) {
    if (!s.series_name) continue;
    bySeries.set(s.series_name, (bySeries.get(s.series_name) ?? 0) + (s.field_size ?? 0));
  }

  let ranked = [...bySeries.entries()].sort((a, b) => b[1] - a[1]);
  if (category) {
    const lower = category.toLowerCase();
    ranked = ranked.filter(([name]) => name.toLowerCase().includes(lower));
  }
  ranked = truncateList(ranked, 15);

  if (ranked.length === 0) {
    return { embeds: [{ title: "Series popularity", description: "No scheduled-session data available.", color: BRAND_COLOR }] };
  }

  const chartUrl = buildBarChart(ranked.map(([name]) => name), ranked.map(([, count]) => count), "Drivers (scheduled field size)");

  return {
    embeds: [
      {
        title: category ? `Series popularity — ${category}` : "Series popularity",
        description: ranked.map(([name, count], i) => `${i + 1}. **${name}** — ${count}`).join("\n").slice(0, 3800),
        color: BRAND_COLOR,
        image: { url: chartUrl },
      },
    ],
  };
};
