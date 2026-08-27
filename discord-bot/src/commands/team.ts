import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { listTrackedDrivers } from "../lib/db.ts";
import { fetchMemberInfo, fetchRecentRaces } from "../lib/iracingLookups.ts";
import { BRAND_COLOR, truncateList } from "../lib/format.ts";

const MAX_DRIVERS = 25;

export const teamCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const { name, options } = getSubcommand(interaction.data!);
  const drivers = truncateList(await listTrackedDrivers(env.DB, guildId), MAX_DRIVERS);
  if (drivers.length === 0) {
    return { embeds: [{ description: "No tracked drivers yet - add some with `/manage_team add`.", color: BRAND_COLOR }] };
  }

  switch (name) {
    case "colors":
      return {
        embeds: [
          {
            title: "Team highlight colors",
            description: drivers.map((d) => `${d.highlight_color ?? "—"} · ${d.display_name ?? `#${d.cust_id}`}`).join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };

    case "discord_mappings":
      return {
        embeds: [
          {
            title: "Linked Discord accounts",
            description: drivers
              .map((d) => `${d.display_name ?? `#${d.cust_id}`} — ${d.discord_user_id ? `<@${d.discord_user_id}>` : "not linked"}`)
              .join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };

    case "divisions": {
      const infos = await Promise.all(drivers.map((d) => fetchMemberInfo(env, d.cust_id).catch(() => null)));
      const rows = drivers.map((d, i) => {
        const licenses: any[] = infos[i]?.licenses ?? [];
        const road = licenses.find((l) => /road/i.test(l.category_name ?? l.category ?? "")) ?? licenses[0];
        return { name: d.display_name ?? `#${d.cust_id}`, irating: road?.irating ?? null };
      });
      rows.sort((a, b) => (b.irating ?? 0) - (a.irating ?? 0));
      return {
        embeds: [
          {
            title: "Team divisions (by iRating)",
            description: rows.map((r) => `**${r.name}** — iR ${r.irating ?? "—"}`).join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };
    }

    case "inactive": {
      const races = await Promise.all(drivers.map((d) => fetchRecentRaces(env, d.cust_id).catch(() => [])));
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const inactive = drivers.filter((_d, i) => {
        const latest = races[i][0];
        const lastRaceTime = latest?.start_time ? new Date(latest.start_time).getTime() : 0;
        return lastRaceTime < cutoff;
      });
      return {
        embeds: [
          {
            title: "Inactive drivers (14+ days)",
            description: inactive.length ? inactive.map((d) => d.display_name ?? `#${d.cust_id}`).join("\n") : "Everyone's been racing recently. 🎉",
            color: BRAND_COLOR,
          },
        ],
      };
    }

    case "quick_stats": {
      const sortBy = optString(options, "sort_by") ?? "irating";
      const [infos, races] = await Promise.all([
        Promise.all(drivers.map((d) => fetchMemberInfo(env, d.cust_id).catch(() => null))),
        Promise.all(drivers.map((d) => fetchRecentRaces(env, d.cust_id).catch(() => []))),
      ]);
      const rows = drivers.map((d, i) => {
        const licenses: any[] = infos[i]?.licenses ?? [];
        const primary = licenses[0];
        const incidents = races[i].slice(0, 5).reduce((sum: number, r: any) => sum + (r.incidents ?? 0), 0);
        return { name: d.display_name ?? `#${d.cust_id}`, irating: primary?.irating ?? 0, incidents };
      });

      if (sortBy === "incidents") rows.sort((a, b) => a.incidents - b.incidents);
      else if (sortBy === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
      else rows.sort((a, b) => b.irating - a.irating);

      return {
        embeds: [
          {
            title: "Team quick stats",
            description: rows.map((r) => `**${r.name}** — iR ${r.irating}, ${r.incidents}x (last 5 races)`).join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };
    }

    default:
      return { content: "Unknown /team subcommand." };
  }
};
