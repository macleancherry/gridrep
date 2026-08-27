import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveDriver, fetchRecentRaces } from "../lib/iracingLookups.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

// Derived from the driver's recent official races (the Data API doesn't
// expose an all-time "awards" ledger directly), so this reflects the last
// ~10 races rather than career totals.
export const awardsCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const query = optString(options, "driver");
  if (!query) return { content: "A driver is required." };

  const driver = await resolveDriver(env, query);
  const races = truncateList(await fetchRecentRaces(env, driver.custId), 10);

  const poles = races.filter((r) => r.start_position === 0).length;
  const wins = races.filter((r) => r.finish_position === 0).length;
  const podiums = races.filter((r) => (r.finish_position ?? 99) <= 2).length;
  const overtakesGained = races.reduce((sum, r) => {
    const gained = (r.start_position ?? 0) - (r.finish_position ?? 0);
    return sum + Math.max(0, gained);
  }, 0);

  return {
    embeds: [
      {
        title: `${driver.displayName} — recent awards`,
        description: `Last ${races.length} official races`,
        color: BRAND_COLOR,
        fields: [
          { name: "Wins", value: String(wins), inline: true },
          { name: "Podiums", value: String(podiums), inline: true },
          { name: "Poles", value: String(poles), inline: true },
          { name: "Positions gained", value: String(overtakesGained), inline: true },
        ],
      },
    ],
  };
};
