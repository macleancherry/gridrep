// League-scoped Data API calls. As with the other analytics helpers, exact
// response shapes are best-effort (league endpoints are lightly documented
// even in community wrappers) and every read is defensive.
import { iracingGet, type BotEnv } from "./iracingAuth.ts";

export async function fetchLeagueInfo(env: BotEnv, leagueId: number): Promise<any> {
  return iracingGet(env, `/data/league/get?league_id=${leagueId}`);
}

export async function fetchLeagueSeasons(env: BotEnv, leagueId: number): Promise<any[]> {
  const data: any = await iracingGet(env, `/data/league/seasons?league_id=${leagueId}`);
  return Array.isArray(data) ? data : (data?.seasons ?? []);
}

export async function fetchLeagueSeasonStandings(env: BotEnv, leagueId: number, leagueSeasonId: number): Promise<any[]> {
  const data: any = await iracingGet(env, `/data/league/season_standings?league_id=${leagueId}&league_season_id=${leagueSeasonId}`);
  return Array.isArray(data) ? data : (data?.standings ?? []);
}

export async function fetchLeagueRoster(env: BotEnv, leagueId: number): Promise<any[]> {
  const data: any = await iracingGet(env, `/data/league/roster?league_id=${leagueId}`);
  return Array.isArray(data) ? data : (data?.roster ?? []);
}

/** Best-effort: a driver's results within this league (falls back to empty on any shape mismatch). */
export async function fetchCustLeagueSessions(env: BotEnv, leagueId: number, custId: number): Promise<any[]> {
  try {
    const data: any = await iracingGet(env, `/data/league/cust_league_sessions?cust_id=${custId}&league_id=${leagueId}`);
    return Array.isArray(data) ? data : (data?.sessions ?? []);
  } catch {
    return [];
  }
}
