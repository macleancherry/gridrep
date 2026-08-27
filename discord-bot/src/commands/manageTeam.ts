import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString, optBoolean } from "../discord/types.ts";
import { resolveDriver } from "../lib/iracingLookups.ts";
import { addTrackedDriver, removeTrackedDriver, updateTrackedDriver } from "../lib/db.ts";
import { BRAND_COLOR } from "../lib/format.ts";

export const manageTeamCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const { name, options } = getSubcommand(interaction.data!);
  const driverQuery = optString(options, "driver");
  if (!driverQuery) return { content: "A driver is required." };

  const driver = await resolveDriver(env, driverQuery);
  const discordUserId = (interaction.data!.options?.[0]?.options ?? []).find((o) => o.name === "discord_user")?.value as
    | string
    | undefined;

  switch (name) {
    case "add":
      await addTrackedDriver(env.DB, guildId, driver.custId, { displayName: driver.displayName, discordUserId });
      return { embeds: [{ description: `✅ Now tracking **${driver.displayName}**.`, color: BRAND_COLOR }] };

    case "remove":
      await removeTrackedDriver(env.DB, guildId, driver.custId);
      return { embeds: [{ description: `🗑️ Stopped tracking **${driver.displayName}**.`, color: BRAND_COLOR }] };

    case "update": {
      const highlightColor = optString(options, "highlight_color");
      await updateTrackedDriver(env.DB, guildId, driver.custId, {
        ...(highlightColor ? { highlight_color: highlightColor } : {}),
        ...(discordUserId ? { discord_user_id: discordUserId } : {}),
      });
      return { embeds: [{ description: `✏️ Updated **${driver.displayName}**.`, color: BRAND_COLOR }] };
    }

    case "announcements_exclude": {
      const excluded = optBoolean(options, "excluded") ?? false;
      await updateTrackedDriver(env.DB, guildId, driver.custId, { excluded_from_announcements: excluded ? 1 : 0 });
      return {
        embeds: [
          {
            description: `${excluded ? "🔕" : "🔔"} **${driver.displayName}** ${excluded ? "excluded from" : "included in"} race announcements.`,
            color: BRAND_COLOR,
          },
        ],
      };
    }

    default:
      return { content: "Unknown /manage_team subcommand." };
  }
};
