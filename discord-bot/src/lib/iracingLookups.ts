// Thin helpers over the iRacing Data API for resolving user-typed driver
// names / series names to the ids the rest of the endpoints need. The Data
// API's exact response shapes vary by endpoint and are only documented via
// community wrappers, so parsing here is defensive (treat responses as
// loosely-typed and guard every field) rather than asserting a strict type,
// matching the pattern already used in functions/api/auth/callback.ts.
import { iracingGet, type BotEnv } from "./iracingAuth.ts";

export type ResolvedDriver = { custId: number; displayName: string };

export async function resolveDriver(env: BotEnv, query: string): Promise<ResolvedDriver> {
  const trimmed = query.trim();

  if (/^\d+$/.test(trimmed)) {
    const custId = Number(trimmed);
    const info: any = await iracingGet(env, `/data/member/get?cust_ids=${custId}`);
    const member = info?.members?.[0];
    return { custId, displayName: member?.display_name ?? `Driver ${custId}` };
  }

  const results: any = await iracingGet(env, `/data/lookup/drivers?search_term=${encodeURIComponent(trimmed)}`);
  const list: any[] = Array.isArray(results) ? results : (results?.list ?? []);
  const match = list[0];
  if (!match) throw new Error(`No driver found matching "${query}".`);
  return { custId: match.cust_id, displayName: match.display_name ?? query };
}

export type ResolvedSeries = { seriesId: number; seriesName: string };

export async function resolveSeries(env: BotEnv, query: string): Promise<ResolvedSeries> {
  const trimmed = query.trim();
  const data: any = await iracingGet(env, "/data/series/get");
  const list: any[] = Array.isArray(data) ? data : (data?.series ?? []);

  if (/^\d+$/.test(trimmed)) {
    const seriesId = Number(trimmed);
    const found = list.find((s) => s.series_id === seriesId);
    return { seriesId, seriesName: found?.series_name ?? `Series ${seriesId}` };
  }

  const lower = trimmed.toLowerCase();
  const found = list.find((s) => (s.series_name ?? "").toLowerCase().includes(lower));
  if (!found) throw new Error(`No series found matching "${query}".`);
  return { seriesId: found.series_id, seriesName: found.series_name };
}

export type ResolvedSeason = { seasonId: number; seasonName: string };

/** The active season for a series, or a specific one if `seasonQuery` names a year/quarter or season id. */
export async function resolveSeason(env: BotEnv, seriesId: number, seasonQuery?: string): Promise<ResolvedSeason | null> {
  const data: any = await iracingGet(env, "/data/series/seasons?include_series=true");
  const list: any[] = Array.isArray(data) ? data : (data?.seasons ?? []);
  const seasonsForSeries = list.filter((s) => s.series_id === seriesId);

  if (seasonQuery && /^\d+$/.test(seasonQuery.trim())) {
    const seasonId = Number(seasonQuery.trim());
    const found = seasonsForSeries.find((s) => s.season_id === seasonId) ?? { season_id: seasonId, season_name: undefined };
    return { seasonId, seasonName: found.season_name ?? `Season ${seasonId}` };
  }

  const active = seasonsForSeries.find((s) => s.active) ?? seasonsForSeries[0];
  if (!active) return null;
  return { seasonId: active.season_id, seasonName: active.season_name ?? active.season_name_short ?? `Season ${active.season_id}` };
}

export async function fetchMemberSummary(env: BotEnv, custId: number): Promise<any> {
  return iracingGet(env, `/data/stats/member_summary?cust_id=${custId}`);
}

export async function fetchMemberInfo(env: BotEnv, custId: number): Promise<any> {
  const info: any = await iracingGet(env, `/data/member/get?cust_ids=${custId}&include_licenses=true`);
  return info?.members?.[0] ?? null;
}

export async function fetchRecentRaces(env: BotEnv, custId: number): Promise<any[]> {
  const data: any = await iracingGet(env, `/data/stats/member_recent_races?cust_id=${custId}`);
  return Array.isArray(data) ? data : (data?.races ?? []);
}
