import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { getDefaultLeague, setLeagueDefaultSeason } from "../lib/db.ts";
import { resolveDriver } from "../lib/iracingLookups.ts";
import {
  fetchLeagueInfo,
  fetchLeagueSeasons,
  fetchLeagueSeasonStandings,
  fetchCustLeagueSessions,
} from "../lib/leagueApi.ts";
import { BRAND_COLOR, ordinal, truncateList } from "../lib/format.ts";
import type { BotLeague } from "../lib/db.ts";

const NO_LEAGUE = { content: "No league configured for this server. An admin can set one with `/setup leagues action:add`." };

async function seasonIdFor(env: any, league: BotLeague): Promise<number | null> {
  if (league.default_season_id) return league.default_season_id;
  const seasons = await fetchLeagueSeasons(env, league.league_id);
  return seasons[0]?.league_season_id ?? seasons[0]?.season_id ?? null;
}

export const leagueCommand: CommandHandler = async (interaction, env) => {
  const guildId = interaction.guild_id;
  if (!guildId) return { content: "This command only works in a server." };

  const league = await getDefaultLeague(env.DB, guildId);
  if (!league) return NO_LEAGUE;

  const { name, options } = getSubcommand(interaction.data!);

  switch (name) {
    case "info": {
      const info: any = await fetchLeagueInfo(env, league.league_id);
      return {
        embeds: [
          {
            title: info?.league_name ?? league.name ?? `League ${league.league_id}`,
            description: info?.description ?? "No description available.",
            color: BRAND_COLOR,
            footer: { text: `${info?.roster_count ?? "?"} members` },
          },
        ],
      };
    }

    case "seasons": {
      const seasonQuery = optString(options, "season");
      const seasons = await fetchLeagueSeasons(env, league.league_id);
      if (seasonQuery) {
        const match = seasons.find((s: any) => String(s.season_name ?? "").toLowerCase().includes(seasonQuery.toLowerCase()));
        const seasonId = match?.league_season_id ?? match?.season_id ?? (/^\d+$/.test(seasonQuery) ? Number(seasonQuery) : null);
        if (seasonId == null) return { content: `No season matching "${seasonQuery}".` };
        await setLeagueDefaultSeason(env.DB, guildId, league.league_id, seasonId);
        return { embeds: [{ description: `✅ Default league season set to **${match?.season_name ?? seasonId}**.`, color: BRAND_COLOR }] };
      }
      return {
        embeds: [
          {
            title: "League seasons",
            description: seasons.map((s: any) => `${s.season_name ?? s.league_season_id} ${s.league_season_id === league.default_season_id ? "(default)" : ""}`).join("\n") || "No seasons found.",
            color: BRAND_COLOR,
          },
        ],
      };
    }

    case "championship": {
      const seasonId = await seasonIdFor(env, league);
      if (seasonId == null) return { content: "No league season available." };
      const standings = truncateList(await fetchLeagueSeasonStandings(env, league.league_id, seasonId), 20);
      if (standings.length === 0) return { embeds: [{ description: "No standings yet for this league season.", color: BRAND_COLOR }] };
      return {
        embeds: [
          {
            title: `${league.name ?? "League"} championship`,
            description: standings.map((s: any, i: number) => `${i + 1}. **${s.display_name ?? `#${s.cust_id}`}** — ${s.points ?? 0} pts`).join("\n"),
            color: BRAND_COLOR,
          },
        ],
      };
    }

    case "driver": {
      const query = optString(options, "driver");
      if (!query) return { content: "A driver is required." };
      const driver = await resolveDriver(env, query);
      const seasonId = await seasonIdFor(env, league);
      const standings = seasonId != null ? await fetchLeagueSeasonStandings(env, league.league_id, seasonId) : [];
      const row = standings.find((s: any) => s.cust_id === driver.custId);
      if (!row) return { embeds: [{ title: driver.displayName, description: "No league standings found for this driver.", color: BRAND_COLOR }] };
      return {
        embeds: [
          {
            title: driver.displayName,
            color: BRAND_COLOR,
            fields: [
              { name: "Points", value: String(row.points ?? 0), inline: true },
              { name: "Wins", value: String(row.wins ?? 0), inline: true },
              { name: "Starts", value: String(row.starts ?? 0), inline: true },
            ],
          },
        ],
      };
    }

    case "compare": {
      const aQuery = optString(options, "driver_a");
      const bQuery = optString(options, "driver_b");
      if (!aQuery || !bQuery) return { content: "Both drivers are required." };
      const [a, b] = await Promise.all([resolveDriver(env, aQuery), resolveDriver(env, bQuery)]);
      const seasonId = await seasonIdFor(env, league);
      const standings = seasonId != null ? await fetchLeagueSeasonStandings(env, league.league_id, seasonId) : [];
      const rowA = standings.find((s: any) => s.cust_id === a.custId);
      const rowB = standings.find((s: any) => s.cust_id === b.custId);
      return {
        embeds: [
          {
            title: `${a.displayName} vs. ${b.displayName}`,
            color: BRAND_COLOR,
            fields: [
              { name: a.displayName, value: `${rowA?.points ?? 0} pts, ${rowA?.wins ?? 0} wins`, inline: true },
              { name: b.displayName, value: `${rowB?.points ?? 0} pts, ${rowB?.wins ?? 0} wins`, inline: true },
            ],
          },
        ],
      };
    }

    case "track_stats": {
      const track = optString(options, "track");
      return {
        embeds: [
          { title: `League track stats — ${track}`, description: "Track-level league breakdowns require per-session results not exposed by the aggregate league standings endpoint. Use `/league previous_races` for individual session detail.", color: BRAND_COLOR },
        ],
      };
    }

    case "awards": {
      const seasonId = await seasonIdFor(env, league);
      const standings = seasonId != null ? await fetchLeagueSeasonStandings(env, league.league_id, seasonId) : [];
      if (standings.length === 0) return { embeds: [{ description: "No league standings available yet.", color: BRAND_COLOR }] };
      const mostWins = [...standings].sort((a: any, b: any) => (b.wins ?? 0) - (a.wins ?? 0))[0];
      const mostPoints = [...standings].sort((a: any, b: any) => (b.points ?? 0) - (a.points ?? 0))[0];
      return {
        embeds: [
          {
            title: `${league.name ?? "League"} awards`,
            color: BRAND_COLOR,
            fields: [
              { name: "Most wins", value: `${mostWins?.display_name ?? "—"} (${mostWins?.wins ?? 0})`, inline: true },
              { name: "Points leader", value: `${mostPoints?.display_name ?? "—"} (${mostPoints?.points ?? 0})`, inline: true },
            ],
          },
        ],
      };
    }

    case "previous_race":
    case "previous_races": {
      const query = optString(options, "driver");
      if (!query) return { content: "A driver is required." };
      const driver = await resolveDriver(env, query);
      const sessions = await fetchCustLeagueSessions(env, league.league_id, driver.custId);
      if (sessions.length === 0) {
        return { embeds: [{ title: driver.displayName, description: "No league race history available.", color: BRAND_COLOR }] };
      }
      const count = name === "previous_race" ? 1 : 10;
      const shown = truncateList(sessions, count);
      const lines = shown.map((s: any) => `${s.session_name ?? "Race"} — ${s.finish_position != null ? ordinal(s.finish_position + 1) : "—"}`);
      return {
        embeds: [{ title: `${driver.displayName} — league races`, description: lines.join("\n"), color: BRAND_COLOR }],
      };
    }

    default:
      return { content: "Unknown /league subcommand." };
  }
};
