import { iracingDataGet } from "./iracing";

/**
 * Thin wrappers around the iRacing Data API endpoints the planner needs, ported from
 * functions/_lib/paceIracing.ts as an independent copy (per the PRD's "copy, don't depend
 * on Pace" decision - Pace is slated for removal). The subsession/lap-data helpers below
 * are confirmed live (Pace already exercises them in production). The event-discovery
 * helpers at the bottom (fetchSeasonList / classifyAsSpecialEvent / extractSessionConditions)
 * are new and NOT live-confirmed - built defensively with multiple field-name fallbacks,
 * same tolerance-for-uncertainty approach as everything else in this file, but the exact
 * payload shape needs confirming with a real access token post-deploy (see the audit/spike
 * plan report for what's still open).
 */

export type SimSessionInfo = {
  simsessionNumber: number;
  type: "qualifying" | "race";
  custIds: string[];
};

export function describeIracingError(err: any): string {
  const status = err?.status;
  const raw = typeof err?.raw === "string" ? err.raw.trim() : "";
  const base = err?.message ?? String(err);

  if (raw && raw !== base) {
    const truncated = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
    return status ? `${status}: ${truncated}` : `${base}: ${truncated}`;
  }

  return base;
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  return undefined;
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function pickRows(sr: any): any[] {
  if (Array.isArray(sr?.results)) return sr.results;
  if (Array.isArray(sr?.result_rows)) return sr.result_rows;
  if (Array.isArray(sr?.rows)) return sr.rows;
  return [];
}

function classifySimSessionType(sr: any): "qualifying" | "race" | null {
  const name = (pickString(sr?.simsession_type_name) ?? "").toUpperCase();
  if (name === "RACE") return "race";
  if (name === "QUALIFY" || name === "QUALIFYING" || name === "LONE QUALIFY") return "qualifying";

  const fuzzyName = (pickString(sr?.simsession_name) ?? "").toLowerCase();
  if (/race/.test(fuzzyName)) return "race";
  if (/qual/.test(fuzzyName)) return "qualifying";

  const type = pickNumber(sr?.simsession_type);
  if (type === 6) return "race";
  if (type === 5) return "qualifying";

  return null;
}

export function describeSimSessionBlocks(resultPayload: any): string {
  const blocks = Array.isArray(resultPayload?.session_results) ? resultPayload.session_results : [];
  if (blocks.length === 0) return "none (no session_results array on payload)";

  return blocks
    .map((b: any) => {
      const num = pickNumber(b?.simsession_number);
      const name = pickString(b?.simsession_type_name) ?? pickString(b?.simsession_name) ?? "?";
      const rowCount = pickRows(b).length;
      return `#${num ?? "?"} "${name}" (${rowCount} rows)`;
    })
    .join(", ");
}

export function extractDriverNames(resultPayload: any): Map<string, string> {
  const names = new Map<string, string>();
  const blocks = Array.isArray(resultPayload?.session_results) ? resultPayload.session_results : [];

  for (const block of blocks) {
    for (const row of pickRows(block)) {
      const custId = pickNumber(row?.cust_id ?? row?.id);
      const name = pickString(row?.display_name) ?? pickString(row?.name);
      if (custId !== undefined && name) names.set(String(custId), name);
    }
  }

  return names;
}

export function extractSessionHeader(payload: any): {
  start_time?: string;
  series_name?: string;
  track_name?: string;
} {
  const start =
    pickString(payload?.start_time) ??
    pickString(payload?.subsession_start_time) ??
    pickString(payload?.session_start_time);

  const series =
    pickString(payload?.series_name) ?? pickString(payload?.series?.series_name) ?? pickString(payload?.event_name);

  const track =
    pickString(payload?.track_name) ??
    pickString(payload?.track?.track_name) ??
    pickString(payload?.track?.track_name_full);

  return { start_time: start, series_name: series, track_name: track };
}

/**
 * Per-session weather extraction - field names confirmed live (2026-07-18) against a real
 * completed subsession (24 Hours of Spa), via a one-off authenticated probe run directly
 * against members-ng.iracing.com, not through this codebase. Two real corrections versus
 * the original best-effort guess:
 *
 * 1. The top-level `payload.weather` object is real and holds a single point-in-time
 *    reading (`temp_value`, `time_of_day`, `skies`, `track_water`, `rel_humidity`,
 *    `wind_dir`/`wind_value`, `fog`, `precip_*`, `simulated_start_time`). There's also a
 *    richer per-sim-session `session_results[i].weather_result` (avg/min/max over that
 *    block) - not used here since this function works off the subsession as a whole, but
 *    worth knowing about if per-simsession granularity is ever needed.
 * 2. `payload.track_state` is a REAL key but means rubber buildup
 *    (`practice_rubber`/`qualify_rubber`/`race_rubber`/`leave_marbles`), not moisture -
 *    a naming collision with our own `track_state` DB column (which means wetness, per
 *    the PRD's §6 vocabulary). Wetness instead comes from `weather.track_water`.
 *
 * Two things the live probe could NOT confirm and are still guesses, documented as such:
 * - No distinct "track temperature" field was found anywhere in the payload (only
 *   `weather.temp_value`, which reads as ambient/air temp) - trackTempC is left unset
 *   rather than guessed from the wrong field.
 * - `weather.time_of_day` is a numeric enum with an unconfirmed value mapping (saw `2` for
 *   a race that started at 15:40 local-simulated time) - rather than guess the enum,
 *   timeOfDay is derived from the hour in `simulated_start_time` directly.
 * - `weather.track_water`'s exact scale is unconfirmed beyond "0 was a real dry race" -
 *   treated as a coarse dry/wet boundary at 0, not a finer band.
 */
export function extractSessionConditions(payload: any): {
  trackTempC?: number;
  airTempC?: number;
  trackState?: string;
  timeOfDay?: string;
} {
  const weather = payload?.weather ?? {};

  const trackTempC = undefined; // no confirmed distinct track-temp field - see header comment

  const rawTemp = pickNumber(weather?.temp_value);
  // temp_units: confirmed live as `1` for a genuine ~19°C summer evening at Spa - `0`
  // is assumed Fahrenheit by elimination (iRacing's only other common unit), converted
  // for consistency since our schema stores a single Celsius column.
  const airTempC =
    rawTemp === undefined ? undefined : weather?.temp_units === 0 ? Math.round(((rawTemp - 32) * 5) / 9) : rawTemp;

  const trackWater = pickNumber(weather?.track_water);
  const trackState = trackWater === undefined ? undefined : trackWater === 0 ? "dry" : "wet";

  const simulatedStart = pickString(weather?.simulated_start_time);
  let timeOfDay: string | undefined;
  if (simulatedStart) {
    const hour = new Date(`${simulatedStart}Z`).getUTCHours();
    if (Number.isFinite(hour)) {
      if (hour >= 5 && hour < 7) timeOfDay = "dawn";
      else if (hour >= 7 && hour < 18) timeOfDay = "day";
      else if (hour >= 18 && hour < 21) timeOfDay = "dusk";
      else timeOfDay = "night";
    }
  }

  return { trackTempC, airTempC, trackState, timeOfDay };
}

export async function fetchSubsessionResult(subsessionId: string, accessToken: string): Promise<any> {
  return iracingDataGet<any>(
    `/data/results/get?subsession_id=${encodeURIComponent(subsessionId)}&include_licenses=true`,
    accessToken
  );
}

export function identifySimSessions(resultPayload: any): SimSessionInfo[] {
  const blocks = Array.isArray(resultPayload?.session_results) ? resultPayload.session_results : [];
  const out: SimSessionInfo[] = [];

  for (const block of blocks) {
    const type = classifySimSessionType(block);
    if (!type) continue;

    const simsessionNumber = pickNumber(block?.simsession_number);
    if (simsessionNumber === undefined) continue;

    const rows = pickRows(block);
    const custIds = rows
      .map((r) => pickNumber(r?.cust_id ?? r?.id))
      .filter((id): id is number => typeof id === "number")
      .map(String);

    out.push({ simsessionNumber, type, custIds });
  }

  return out;
}

export type NormalizedLap = {
  custId: string;
  lapNumber: number;
  lapTimeMs: number | null;
};

function rowsFromPayloadShape(payload: any): Array<Record<string, unknown>> {
  const rows: any[] =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.laps) && payload.laps) ||
    (Array.isArray(payload?.lap_data) && payload.lap_data) ||
    (Array.isArray(payload?.results) && payload.results) ||
    [];

  return rows.filter((r) => r && typeof r === "object");
}

async function fetchChunkFileContents(
  chunkInfo: { baseDownloadUrl: string; chunkFileNames: string[] },
  maxFiles = 50
): Promise<unknown[]> {
  const contents: unknown[] = [];

  for (const fileName of chunkInfo.chunkFileNames.slice(0, maxFiles)) {
    try {
      const res = await fetch(`${chunkInfo.baseDownloadUrl}${fileName}`);
      if (!res.ok) continue;
      contents.push(JSON.parse(await res.text()));
    } catch {
      // Ignore a single bad chunk file; partial results are still useful.
    }
  }

  return contents;
}

export async function extractLapRows(lapDataPayload: any): Promise<Array<Record<string, unknown>>> {
  const rows = rowsFromPayloadShape(lapDataPayload);
  if (rows.length > 0) return rows;

  const chunkInfo = getChunkInfo(lapDataPayload);
  if (!chunkInfo) return [];

  const chunks = await fetchChunkFileContents(chunkInfo);
  return chunks.flatMap((chunk) => rowsFromPayloadShape(chunk));
}

export function normalizeLapTimeMs(row: Record<string, unknown>): number | null {
  const raw = pickNumber(
    row.lap_time ?? row.lapTime ?? row.lap_time_ms ?? row.lapTimeMs ?? row.time
  );
  if (raw === undefined || raw < 0) return null;

  if (raw > 100_000) return Math.round(raw / 10);
  if (raw > 1000) return Math.round(raw); // already ms
  return Math.round(raw * 1000); // seconds as float
}

export function extractLapNumber(row: Record<string, unknown>): number | undefined {
  return pickNumber(row.lap_number ?? row.lapNumber ?? row.lap);
}

export function buildLapDataPath(subsessionId: string, custId: string, simsessionNumber: number): string {
  const params = new URLSearchParams({
    subsession_id: subsessionId,
    cust_id: custId,
    simsession_number: String(simsessionNumber),
  });
  return `/data/results/lap_data?${params.toString()}`;
}

export async function fetchLapData(
  subsessionId: string,
  custId: string,
  simsessionNumber: number,
  accessToken: string
): Promise<any> {
  return iracingDataGet<any>(buildLapDataPath(subsessionId, custId, simsessionNumber), accessToken);
}

export async function getLeagueInfo(leagueId: string, accessToken: string): Promise<any> {
  return iracingDataGet<any>(`/data/league/get?league_id=${encodeURIComponent(leagueId)}`, accessToken);
}

export function extractLeagueName(payload: any): string | undefined {
  return pickString(payload?.league_name) ?? pickString(payload?.name);
}

export async function searchHostedSessionsForLeague(
  leagueId: string,
  sinceIso: string | undefined,
  accessToken: string,
  filters: { hostCustId?: string | null; sessionNameFilter?: string | null }
): Promise<any> {
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    league_id: leagueId,
    finish_range_begin: sinceIso ?? ninetyDaysAgoIso,
    finish_range_end: new Date().toISOString(),
  });
  if (filters.hostCustId) params.set("host_cust_id", filters.hostCustId);
  if (filters.sessionNameFilter) params.set("session_name", filters.sessionNameFilter);

  return iracingDataGet<any>(`/data/results/search_hosted?${params.toString()}`, accessToken);
}

function scanForSubsessionIds(payload: unknown, ids: Set<string>) {
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const value = stack.pop();
    if (!value) continue;

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    if (typeof value !== "object") continue;

    const row = value as Record<string, unknown>;
    const subId = pickNumber(row.subsession_id ?? row.subsessionId);
    if (subId !== undefined) ids.add(String(subId));

    for (const nested of Object.values(row)) {
      if (nested && (Array.isArray(nested) || typeof nested === "object")) {
        stack.push(nested);
      }
    }
  }
}

function getChunkInfo(payload: any): { baseDownloadUrl: string; chunkFileNames: string[] } | null {
  const candidates = [payload?.data?.chunk_info, payload?.chunk_info, payload?.chunkInfo].filter(Boolean);

  for (const candidate of candidates) {
    const baseDownloadUrl =
      (typeof candidate?.base_download_url === "string" && candidate.base_download_url) ||
      (typeof candidate?.baseDownloadUrl === "string" && candidate.baseDownloadUrl) ||
      null;

    const chunkFileNamesRaw = candidate?.chunk_file_names ?? candidate?.chunkFileNames;
    const chunkFileNames = Array.isArray(chunkFileNamesRaw)
      ? chunkFileNamesRaw.filter((item: unknown): item is string => typeof item === "string" && item.length > 0)
      : [];

    if (baseDownloadUrl && chunkFileNames.length > 0) {
      return { baseDownloadUrl, chunkFileNames };
    }
  }

  return null;
}

export async function extractSubsessionIds(payload: any): Promise<string[]> {
  const ids = new Set<string>();
  scanForSubsessionIds(payload, ids);

  const chunkInfo = getChunkInfo(payload);
  if (chunkInfo) {
    const chunks = await fetchChunkFileContents(chunkInfo);
    for (const chunk of chunks) scanForSubsessionIds(chunk, ids);
  }

  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Event discovery - new for the planner, NOT live-confirmed (see file header).
// ---------------------------------------------------------------------------

export type DiscoveredEvent = {
  id: string;
  name: string;
  trackName?: string;
  trackConfig?: string;
  seriesId?: string;
  seasonId?: string;
  scheduledStartTime?: string;
  eventType: "special" | "hosted" | "league";
  raw: Record<string, unknown>;
};

/**
 * Season/series discovery. iRacing's community wrapper libraries expose this as
 * GetSeasonListAsync / GetSeasonsAsync, backed by something in the /data/season or
 * /data/series family - the exact path and the field that distinguishes a "special
 * event" season from a regular series season could not be confirmed without a live
 * access token (no credentials available in the audit/spike sandbox). Tries the most
 * likely path first and falls back to a second candidate rather than hard-failing.
 */
export async function fetchSeasonList(accessToken: string): Promise<any> {
  const candidates = ["/data/series/seasons?include_series=true", "/data/season/list"];
  let lastErr: unknown;

  for (const path of candidates) {
    try {
      return await iracingDataGet<any>(path, accessToken);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr;
}

function extractSeasonRows(payload: any): Array<Record<string, unknown>> {
  const rows: any[] =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.seasons) && payload.seasons) ||
    (Array.isArray(payload?.series) && payload.series) ||
    (Array.isArray(payload?.results) && payload.results) ||
    [];

  return rows.filter((r) => r && typeof r === "object");
}

/**
 * Heuristic only - iRacing's exact "this season is a Special Event" flag is unconfirmed.
 * Special Events are historically one-off, non-points series with a fixed short window
 * rather than a recurring multi-week season, so this leans on name/shape signals
 * (e.g. "Special Event" in the series/season name, or a payload field literally named
 * special_event) rather than asserting a specific enum value. Never used to silently
 * drop rows to zero - callers should fall back to showing everything if this yields
 * nothing, the same "transparency over silent filtering" approach the PRD asks for.
 */
function looksLikeSpecialEvent(row: Record<string, unknown>): boolean {
  if (row.special_event === true || row.is_special_event === true) return true;

  const name = (pickString(row.series_name) ?? pickString(row.season_name) ?? "").toLowerCase();
  return name.includes("special event") || /\b\d+\s*hours?\b/.test(name) || /\b\d+h\b/.test(name);
}

export function extractDiscoveredEvents(payload: any, opts: { specialOnly?: boolean } = {}): DiscoveredEvent[] {
  const rows = extractSeasonRows(payload);
  const filtered = opts.specialOnly ? rows.filter(looksLikeSpecialEvent) : rows;
  const source = filtered.length > 0 || !opts.specialOnly ? filtered : rows; // never silently return zero on a bad guess

  return source.map((row) => {
    const seriesId = pickNumber(row.series_id);
    const seasonId = pickNumber(row.season_id);
    const name = pickString(row.series_name) ?? pickString(row.season_name) ?? "Unknown event";
    // No ":" or other characters that need URL-encoding in a path segment - avoids a
    // real Cloudflare Pages dev-router gotcha where an encoded id in the URL doesn't
    // decode back to the stored id by the time it reaches context.params.
    const idSuffix = seasonId !== undefined ? String(seasonId) : String(seriesId ?? name).replace(/[^a-zA-Z0-9_-]/g, "-");
    const id = seasonId !== undefined ? `season-${idSuffix}` : `series-${idSuffix}`;

    return {
      id,
      name,
      trackName: pickString((row.track as any)?.track_name),
      trackConfig: pickString((row.track as any)?.config_name),
      seriesId: seriesId !== undefined ? String(seriesId) : undefined,
      seasonId: seasonId !== undefined ? String(seasonId) : undefined,
      scheduledStartTime: pickString(row.start_date) ?? pickString(row.season_start_date),
      eventType: looksLikeSpecialEvent(row) ? "special" : "league",
      raw: row,
    };
  });
}
