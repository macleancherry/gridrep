import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString, optBoolean, optNumber } from "../discord/types.ts";
import { ensureGuild, updateGuild, setSeriesChannel, removeSeriesChannel, listSeriesChannels, setLeague, removeLeague } from "../lib/db.ts";
import { BRAND_COLOR } from "../lib/format.ts";

function channelOptionId(interaction: import("../discord/types.ts").Interaction, subName: string, optionName: string): string | undefined {
  const sub = interaction.data!.options?.find((o) => o.name === subName);
  const opt = sub?.options?.find((o) => o.name === optionName);
  return opt?.value as string | undefined;
}

function roleOptionId(interaction: import("../discord/types.ts").Interaction, subName: string, optionName: string): string | undefined {
  return channelOptionId(interaction, subName, optionName);
}

export const setupCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };
  await ensureGuild(env.DB, guildId);

  const { name, options } = getSubcommand(interaction.data!);

  switch (name) {
    case "admin_role": {
      const roleId = roleOptionId(interaction, "admin_role", "role");
      if (!roleId) return { content: "A role is required." };
      await updateGuild(env.DB, guildId, { admin_role_id: roleId });
      return { embeds: [{ description: `✅ Admin role set to <@&${roleId}>.`, color: BRAND_COLOR }] };
    }

    case "results_announcer": {
      const channelId = channelOptionId(interaction, "results_announcer", "channel");
      if (!channelId) return { content: "A channel is required." };
      await updateGuild(env.DB, guildId, { default_results_channel_id: channelId });
      return { embeds: [{ description: `✅ Race announcements will post to <#${channelId}>.`, color: BRAND_COLOR }] };
    }

    case "force_channel": {
      const channelId = channelOptionId(interaction, "force_channel", "channel") ?? null;
      await updateGuild(env.DB, guildId, { force_channel_id: channelId });
      return {
        embeds: [
          { description: channelId ? `✅ Bot commands restricted to <#${channelId}>.` : "✅ Command channel restriction cleared.", color: BRAND_COLOR },
        ],
      };
    }

    case "leagues": {
      const action = optString(options, "action");
      const leagueId = optNumber(options, "league_id");
      const leagueName = optString(options, "name") ?? null;
      if (!action || leagueId == null) return { content: "An action and league_id are required." };
      if (action === "add") {
        await setLeague(env.DB, guildId, leagueId, leagueName);
        return { embeds: [{ description: `✅ Tracking league **${leagueName ?? leagueId}**.`, color: BRAND_COLOR }] };
      }
      await removeLeague(env.DB, guildId, leagueId);
      return { embeds: [{ description: `🗑️ Stopped tracking league ${leagueId}.`, color: BRAND_COLOR }] };
    }

    case "hide_flags": {
      const enabled = optBoolean(options, "enabled") ?? false;
      await updateGuild(env.DB, guildId, { hide_flags: enabled ? 1 : 0 });
      return { embeds: [{ description: `✅ Country flags ${enabled ? "hidden" : "shown"}.`, color: BRAND_COLOR }] };
    }

    case "show_license_letter": {
      const enabled = optBoolean(options, "enabled") ?? false;
      await updateGuild(env.DB, guildId, { show_license_letter: enabled ? 1 : 0 });
      return { embeds: [{ description: `✅ License letters ${enabled ? "shown" : "hidden"}.`, color: BRAND_COLOR }] };
    }

    case "mention_race_announcements": {
      const enabled = optBoolean(options, "enabled") ?? false;
      await updateGuild(env.DB, guildId, { mention_race_announcements: enabled ? 1 : 0 });
      return { embeds: [{ description: `✅ @mentions in announcements ${enabled ? "enabled" : "disabled"}.`, color: BRAND_COLOR }] };
    }

    case "view_series_channels": {
      const mappings = await listSeriesChannels(env.DB, guildId);
      if (mappings.length === 0) {
        return { embeds: [{ description: "No series-to-channel mappings configured.", color: BRAND_COLOR }] };
      }
      return {
        embeds: [
          {
            title: "Series → channel mappings",
            description: mappings.map((m) => `Series ${m.series_id} → <#${m.channel_id}>`).join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };
    }

    case "add_series_channel": {
      const seriesId = optNumber(options, "series_id");
      const channelId = channelOptionId(interaction, "add_series_channel", "channel");
      if (seriesId == null || !channelId) return { content: "A series_id and channel are required." };
      await setSeriesChannel(env.DB, guildId, seriesId, channelId);
      return { embeds: [{ description: `✅ Series ${seriesId} will announce to <#${channelId}>.`, color: BRAND_COLOR }] };
    }

    case "remove_series_channel": {
      const seriesId = optNumber(options, "series_id");
      if (seriesId == null) return { content: "A series_id is required." };
      await removeSeriesChannel(env.DB, guildId, seriesId);
      return { embeds: [{ description: `🗑️ Removed channel mapping for series ${seriesId}.`, color: BRAND_COLOR }] };
    }

    case "default_results_channel": {
      const channelId = channelOptionId(interaction, "default_results_channel", "channel");
      if (!channelId) return { content: "A channel is required." };
      await updateGuild(env.DB, guildId, { default_results_channel_id: channelId });
      return { embeds: [{ description: `✅ Default results channel set to <#${channelId}>.`, color: BRAND_COLOR }] };
    }

    default:
      return { content: "Unknown /setup subcommand." };
  }
};
