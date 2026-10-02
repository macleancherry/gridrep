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
import { gatedDriverNameOrLabel } from "../lib/identityGate.ts";

// Full-field standings (championship/awards) are paused pending a product decision on
// whether this bot should keep naming arbitrary league members at all (PRD: iRacing's
// 30 Sept 2026 notice + EULA 6.3 on commercial-style redistribution) - unlike a single
// driver lookup, anonymising every row here would just produce a leaderboard of
// identical placeholder names, which has no real value and could read as broken rather
// than as a privacy choice.
const STANDINGS_PAUSED = {
  content:
    "League-wide standings are temporarily unavailable while we review how this bot handles driver names that aren't gridrep's own team's. `/league driver` and `/league previous_race` still work for one driver at a time.",
};

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

    case "championship":
      return STANDINGS_PAUSED;

    case "driver": {
      const query = optString(options, "driver");
      if (!query) return { content: "A driver is required." };
      const driver = await resolveDriver(env, query);
      const displayName = await gatedDriverNameOrLabel(env.DB, String(driver.custId), driver.displayName);
      const seasonId = await seasonIdFor(env, league);
      const standings = seasonId != null ? await fetchLeagueSeasonStandings(env, league.league_id, seasonId) : [];
      const row = standings.find((s: any) => s.cust_id === driver.custId);
      if (!row) return { embeds: [{ title: displayName, description: "No league standings found for this driver.", color: BRAND_COLOR }] };
      return {
        embeds: [
          {
            title: displayName,
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
      const [aName, bName] = await Promise.all([
        gatedDriverNameOrLabel(env.DB, String(a.custId), a.displayName),
        gatedDriverNameOrLabel(env.DB, String(b.custId), b.displayName),
      ]);
      const seasonId = await seasonIdFor(env, league);
      const standings = seasonId != null ? await fetchLeagueSeasonStandings(env, league.league_id, seasonId) : [];
      const rowA = standings.find((s: any) => s.cust_id === a.custId);
      const rowB = standings.find((s: any) => s.cust_id === b.custId);
      return {
        embeds: [
          {
            title: `${aName} vs. ${bName}`,
            color: BRAND_COLOR,
            fields: [
              { name: aName, value: `${rowA?.points ?? 0} pts, ${rowA?.wins ?? 0} wins`, inline: true },
              { name: bName, value: `${rowB?.points ?? 0} pts, ${rowB?.wins ?? 0} wins`, inline: true },
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

    case "awards":
      return STANDINGS_PAUSED;

    case "previous_race":
    case "previous_races": {
      const query = optString(options, "driver");
      if (!query) return { content: "A driver is required." };
      const driver = await resolveDriver(env, query);
      const displayName = await gatedDriverNameOrLabel(env.DB, String(driver.custId), driver.displayName);
      const sessions = await fetchCustLeagueSessions(env, league.league_id, driver.custId);
      if (sessions.length === 0) {
        return { embeds: [{ title: displayName, description: "No league race history available.", color: BRAND_COLOR }] };
      }
      const count = name === "previous_race" ? 1 : 10;
      const shown = truncateList(sessions, count);
      const lines = shown.map((s: any) => `${s.session_name ?? "Race"} — ${s.finish_position != null ? ordinal(s.finish_position + 1) : "—"}`);
      return {
        embeds: [{ title: `${displayName} — league races`, description: lines.join("\n"), color: BRAND_COLOR }],
      };
    }

    default:
      return { content: "Unknown /league subcommand." };
  }
};
