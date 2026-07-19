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

const SEASON_LIST_CACHE_ID = "season_list";
const SEASON_LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours - the catalog barely changes intra-day

/**
 * Read-through cache over fetchSeasonList (migration 0019). The season/series catalog is
 * the same for every viewer, so one shared D1 row serves the whole team instead of every
 * series/sessions page load paying for a live two-hop iRacing fetch. Refreshed by
 * whichever request finds the cache missing/stale - no cron trigger or dedicated service
 * token needed. A live-fetch failure with a stale row on hand serves the stale payload
 * rather than erroring the page out; only a cold cache with no fallback propagates.
 */
export async function getCachedSeasonList(DB: any, accessToken: string): Promise<{ payload: any; cachedAt: string; stale: boolean }> {
  const row = await DB.prepare(`SELECT payload_json as payloadJson, fetched_at as fetchedAt FROM iracing_series_cache WHERE id = ?`)
    .bind(SEASON_LIST_CACHE_ID)
    .first<any>();

  const isFresh = row && Date.now() - Date.parse(row.fetchedAt) < SEASON_LIST_CACHE_TTL_MS;
  if (isFresh) {
    return { payload: JSON.parse(row.payloadJson), cachedAt: row.fetchedAt, stale: false };
  }

  try {
    const payload = await fetchSeasonList(accessToken);
    const fetchedAt = new Date().toISOString();
    await DB.prepare(
      `INSERT INTO iracing_series_cache (id, payload_json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`
    )
      .bind(SEASON_LIST_CACHE_ID, JSON.stringify(payload), fetchedAt)
      .run();
    return { payload, cachedAt: fetchedAt, stale: false };
  } catch (err) {
    if (row) {
      // iRacing's API hiccuped but we have something to show - serve it rather than
      // failing the whole page, same "degrade gracefully" pattern used for the live
      // tracking proxy.
      return { payload: JSON.parse(row.payloadJson), cachedAt: row.fetchedAt, stale: true };
    }
    throw err;
  }
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

// ---------------------------------------------------------------------------
// Series -> session drill-down (confirmed live 2026-07-18, see plan report).
// A season-level row has NO `track` field - it only exists per-`schedules[i]`
// entry, one per race week. Everything below reads from `schedules[]`, not the
// season row itself, to actually get real track/duration/forecast data.
// ---------------------------------------------------------------------------

export type UpsertEventInput = {
  id: string;
  name: string;
  trackName?: string | null;
  trackConfig?: string | null;
  eventType: "special" | "hosted" | "league";
  scheduledStartTime?: string | null;
  durationMinutes?: number | null;
  seriesId?: string | null;
  seasonId?: string | null;
  seriesName?: string | null;
  minTeamDrivers?: number | null;
  maxTeamDrivers?: number | null;
  minFuelFillPct?: number | null;
  maxFuelFillPct?: number | null;
  minTireSets?: number | null;
  maxTireSets?: number | null;
};

/**
 * Upserts an event into iracing_events, keyed on its own id (per the PRD's "same event +
 * scheduled start resolves to one record" rule, §7). Shared by both the shallow
 * events/select.ts path and the richer series/select-session.ts path - the latter
 * generally has better data (real track/duration from a schedule entry rather than a
 * season row), so re-selecting the same event through it refreshes those fields.
 */
export async function upsertIracingEvent(DB: any, data: UpsertEventInput): Promise<any> {
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO iracing_events (
       id, name, track_name, track_config, event_type, scheduled_start_time,
       duration_minutes, series_id, season_id, series_name, min_team_drivers, max_team_drivers,
       min_fuel_fill_pct, max_fuel_fill_pct, min_tire_sets, max_tire_sets, source, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'iracing_data_api', ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       track_name = COALESCE(excluded.track_name, iracing_events.track_name),
       track_config = COALESCE(excluded.track_config, iracing_events.track_config),
       event_type = excluded.event_type,
       scheduled_start_time = COALESCE(excluded.scheduled_start_time, iracing_events.scheduled_start_time),
       duration_minutes = COALESCE(excluded.duration_minutes, iracing_events.duration_minutes),
       series_id = COALESCE(excluded.series_id, iracing_events.series_id),
       season_id = COALESCE(excluded.season_id, iracing_events.season_id),
       series_name = COALESCE(excluded.series_name, iracing_events.series_name),
       min_team_drivers = COALESCE(excluded.min_team_drivers, iracing_events.min_team_drivers),
       max_team_drivers = COALESCE(excluded.max_team_drivers, iracing_events.max_team_drivers),
       min_fuel_fill_pct = COALESCE(excluded.min_fuel_fill_pct, iracing_events.min_fuel_fill_pct),
       max_fuel_fill_pct = COALESCE(excluded.max_fuel_fill_pct, iracing_events.max_fuel_fill_pct),
       min_tire_sets = COALESCE(excluded.min_tire_sets, iracing_events.min_tire_sets),
       max_tire_sets = COALESCE(excluded.max_tire_sets, iracing_events.max_tire_sets)`
  )
    .bind(
      data.id,
      data.name,
      data.trackName ?? null,
      data.trackConfig ?? null,
      data.eventType,
      data.scheduledStartTime ?? null,
      data.durationMinutes ?? null,
      data.seriesId ?? null,
      data.seasonId ?? null,
      data.seriesName ?? null,
      data.minTeamDrivers ?? null,
      data.maxTeamDrivers ?? null,
      data.minFuelFillPct ?? null,
      data.maxFuelFillPct ?? null,
      data.minTireSets ?? null,
      data.maxTireSets ?? null,
      now
    )
    .run();

  return DB.prepare(`SELECT * FROM iracing_events WHERE id = ?`).bind(data.id).first<any>();
}

export type RacingFormat = "sprint" | "endurance" | "special";
export type RacingDiscipline = "road" | "oval" | "dirt_road" | "dirt_oval";

/** Sprint/endurance/special classification for the onboarding-preference tailored
 * search. "Endurance" is judged by name (contains "endurance", or hour-named like "6
 * Hours of Road America") independently of the one-off special-event flag - confirmed
 * against real data this conflated case exists: "Creventic Endurance Series" and
 * "Nurburgring Endurance Championship" are real, regular (non-special) recurring
 * series, not one-off specials, and were wrongly falling through to "sprint" only
 * before this was split out. A series can be special AND endurance (a one-off named
 * "24 Hours of Spa"), endurance only (a regular multi-hour series), special only (a
 * one-off that isn't hour/endurance-named), or sprint (neither signal). */
export function classifyFormats(row: Record<string, unknown>): RacingFormat[] {
  const name = (pickString(row.series_name) ?? pickString(row.season_name) ?? "").toLowerCase();
  const isHourNamed = /\b\d+\s*hours?\b/.test(name) || /\b\d+h\b/.test(name);
  const isEnduranceNamed = name.includes("endurance") || isHourNamed;
  const isSpecial = looksLikeSpecialEvent(row);

  const out: RacingFormat[] = [];
  if (isSpecial) out.push("special");
  if (isEnduranceNamed) out.push("endurance");
  if (!isSpecial && !isEnduranceNamed) out.push("sprint");
  return out;
}

/** Discipline classification from car_types/track_types tokens - confirmed live
 * (2026-07-19, series/seasons payload) real token values include "road", "oval",
 * "dirt", "dirtroad", "offroad", "offroadtruck", "nascar", mapped onto iRacing's own
 * four license categories. NOT live-confirmed: the exact token(s) for dirt OVAL
 * specifically (the one live example captured was off-road/rallycross-style, not a
 * dirt oval series) - that mapping should be double-checked once a real dirt-oval
 * series payload is seen. A series with no recognizable token returns an empty array
 * rather than a guess - callers must never exclude an unclassified series when
 * filtering, only ones that positively mismatch a stated preference. */
export function classifyDisciplines(row: Record<string, unknown>): RacingDiscipline[] {
  const carTypes = (Array.isArray(row.car_types) ? (row.car_types as any[]) : []).map((c) => String(c?.car_type ?? "").toLowerCase());
  const trackTypes = (Array.isArray(row.track_types) ? (row.track_types as any[]) : []).map((t) => String(t?.track_type ?? "").toLowerCase());
  const tokens = [...carTypes, ...trackTypes];

  const hasDirt = tokens.some((t) => t.includes("dirt"));
  const hasOffroad = tokens.some((t) => t.includes("offroad"));
  const hasOval = tokens.some((t) => t === "oval" || t === "nascar");
  const hasRoad = tokens.some((t) => t === "road" || t.includes("sportscar") || t.includes("formula"));

  const out = new Set<RacingDiscipline>();
  if (hasDirt && hasOval) out.add("dirt_oval");
  if ((hasDirt && !hasOval) || hasOffroad) out.add("dirt_road");
  if (hasOval && !hasDirt) out.add("oval");
  if (hasRoad) out.add("road");

  return Array.from(out);
}

export type SeriesSummary = { seriesId: string; name: string; formats: RacingFormat[]; disciplines: RacingDiscipline[] };

/** Distinct series, deduped by series_id across however many season rows reference it,
 * each tagged with its formats/disciplines for preference-tailored search. Special-event
 * series only by default (today's scope) - pass includeRegularSeries to also surface
 * regular (non-special) series, e.g. for a viewer who's opted into sprint or endurance
 * racing (both formats show up on regular series, not just one-off specials - "Global
 * Endurance Tour" is a real regular series, confirmed live). */
export function extractSeriesList(payload: any, opts: { includeRegularSeries?: boolean } = {}): SeriesSummary[] {
  const rows = extractSeasonRows(payload).filter((row) => opts.includeRegularSeries || looksLikeSpecialEvent(row));
  const bySeriesId = new Map<string, SeriesSummary>();

  for (const row of rows) {
    const seriesId = pickNumber(row.series_id);
    if (seriesId === undefined) continue;
    const key = String(seriesId);
    const formats = classifyFormats(row);
    const disciplines = classifyDisciplines(row);

    const existing = bySeriesId.get(key);
    if (!existing) {
      const name =
        pickString((row.schedules as any)?.[0]?.series_name) ?? pickString(row.series_name) ?? pickString(row.season_name) ?? "Unknown series";
      bySeriesId.set(key, { seriesId: key, name, formats, disciplines });
    } else {
      existing.formats = Array.from(new Set([...existing.formats, ...formats]));
      existing.disciplines = Array.from(new Set([...existing.disciplines, ...disciplines]));
    }
  }

  return Array.from(bySeriesId.values());
}

export type ScheduleSession = {
  seasonId: string;
  raceWeekNum: number;
  scheduleName?: string;
  trackName?: string;
  trackConfig?: string;
  specialEventType?: number;
  scheduledStartTime?: string; // ISO - this slot's real-world start (when practice opens, if attached)
  slotIndex: number; // which alternative real-world start time this row represents
  slotCount: number; // how many alternative start times this schedule entry offers in total
  practiceLengthMinutes?: number;
  qualifyLengthMinutes?: number;
  warmupLengthMinutes?: number;
  raceLengthMinutes?: number; // race-only duration - NOT the whole weekend's span
  forecastAvailable: boolean;
  weatherUrl?: string;
  forecastSummary?: { tempLowC: number; tempHighC: number; precipChancePct: number };
  minTeamDrivers?: number;
  maxTeamDrivers?: number;
  minFuelFillPct?: number;
  maxFuelFillPct?: number;
  minTireSets?: number;
  maxTireSets?: number;
};

/** Pre-computed temp-high/low + precip-chance summary iRacing already provides right next
 * to weather_url - confirmed live (2026-07-18) alongside the same "6 Hours of Road
 * America" probe. Cheaper than fetching the full hourly timeline just to preview a
 * session before selecting it. Same temp_units 0=F/1=C convention as extractSessionConditions. */
function extractForecastSummary(schedule: Record<string, unknown>): ScheduleSession["forecastSummary"] {
  const weather = schedule.weather as any;
  const summary = weather?.weather_summary;
  if (!summary) return undefined;

  const tempUnits = pickNumber(summary.temp_units);
  const toC = (v: number | undefined) => (v === undefined ? undefined : tempUnits === 0 ? Math.round(((v - 32) * 5) / 9) : v);

  const tempLowC = toC(pickNumber(summary.temp_low));
  const tempHighC = toC(pickNumber(summary.temp_high));
  // Not independently confirmed live for this summary field specifically (every prior
  // observation of it happened to be exactly 0, which can't reveal a scale bug) - scaled
  // to match the now-confirmed centi-percent convention on the hourly precip_chance
  // field below, since both plausibly come from the same weather pipeline.
  const rawPrecipChance = pickNumber(summary.precip_chance);
  const precipChancePct = rawPrecipChance === undefined ? undefined : rawPrecipChance / 100;
  if (tempLowC === undefined || tempHighC === undefined) return undefined;

  return { tempLowC, tempHighC, precipChancePct: precipChancePct ?? 0 };
}

/** Fuel-fill/tyre-set caps, aggregated (min/max) across every car eligible for this
 * schedule - confirmed live via car_restrictions[].max_pct_fuel_fill/max_dry_tire_sets.
 * Aggregated rather than per-car because the planner has no car-selection feature to
 * match a specific car against; shown as an informational range, not a per-plan check. */
function extractCarRegulationSummary(schedule: Record<string, unknown>): {
  minFuelFillPct?: number;
  maxFuelFillPct?: number;
  minTireSets?: number;
  maxTireSets?: number;
} {
  const restrictions = Array.isArray(schedule.car_restrictions) ? (schedule.car_restrictions as Record<string, unknown>[]) : [];
  const fuelPcts = restrictions.map((r) => pickNumber(r.max_pct_fuel_fill)).filter((v): v is number => v !== undefined);
  const tireSets = restrictions.map((r) => pickNumber(r.max_dry_tire_sets)).filter((v): v is number => v !== undefined);

  return {
    minFuelFillPct: fuelPcts.length ? Math.min(...fuelPcts) : undefined,
    maxFuelFillPct: fuelPcts.length ? Math.max(...fuelPcts) : undefined,
    minTireSets: tireSets.length ? Math.min(...tireSets) : undefined,
    maxTireSets: tireSets.length ? Math.max(...tireSets) : undefined,
  };
}

/** Season-level roster size limits - confirmed live (min_team_drivers: 2, max_team_drivers:
 * 16 for the probed event), sibling to schedules[] rather than nested inside a schedule
 * entry, so threaded onto each ScheduleSession row from the season row, not the schedule. */
function extractTeamSizeLimits(season: Record<string, unknown>): { minTeamDrivers?: number; maxTeamDrivers?: number } {
  return {
    minTeamDrivers: pickNumber(season.min_team_drivers),
    maxTeamDrivers: pickNumber(season.max_team_drivers),
  };
}

/**
 * Pit-stop ruleset guess (PRD-adjacent, not PRD-sourced) - the Data API has no queryable
 * field for this (exhaustively checked: a fresh series/seasons re-fetch, series/get,
 * series/assets, and the full /data/doc endpoint catalog - no "rules"/"regulations"
 * category exists anywhere). This is a real Season 3 sim feature per iRacing's own
 * release notes (boxthislap.org/iracing-2026-season-3-release-notes, user-supplied), which
 * name real series -> ruleset mappings explicitly - matched here by name, case-insensitive
 * substring, never asserted as confirmed data. iRacing's own stated global default is
 * sequential - only overridden when a real name match fires.
 */
export function guessPitRuleset(seriesName: string | null | undefined): { simultaneousFuelTyres: boolean; note: string } | null {
  if (!seriesName) return null;
  const name = seriesName.toLowerCase();

  const IMSA = ["imsa", "bmw m2 cup", "watkins glen 6 hour", "6 hours of road america", "petit le mans"];
  const NEC = ["nürburgring endurance", "nurburgring endurance", "nec"];
  const DTM = ["dtm"];

  if (IMSA.some((k) => name.includes(k))) {
    return { simultaneousFuelTyres: true, note: "Guessed from iRacing's IMSA ruleset for this event - confirm with your team." };
  }
  if (NEC.some((k) => name.includes(k))) {
    return {
      simultaneousFuelTyres: true,
      note: "Guessed from iRacing's Nürburgring Endurance ruleset (simultaneous, slower fuel rate) - confirm with your team.",
    };
  }
  if (DTM.some((k) => name.includes(k))) {
    return {
      simultaneousFuelTyres: true,
      note: "Guessed from iRacing's DTM ruleset (simultaneous, faster tyre changes) - confirm with your team.",
    };
  }

  return null;
}

/**
 * Resolves the real-world start time(s) a schedule entry can be joined at. Two
 * confirmed-live shapes (2026-07-18 live probe, "6 Hours of Road America"):
 * - Special/endurance events: `race_time_descriptors[].session_times[]`, an array of
 *   full ISO timestamps - a genuine special event offered 5 alternative start times
 *   spaced 4-9h apart (each comfortably longer than the event itself), so a team can
 *   join whichever real-world slot suits them. `first_session_time` does NOT exist on
 *   this event type.
 * - Regular repeating series (confirmed earlier this session, Mazda MX-5 Cup):
 *   `race_time_descriptors[0].first_session_time`, a single time-of-day string
 *   combined with `start_date` - one slot only.
 * Tries every descriptor's `session_times` first (the richer, more common shape for
 * anything this planner cares about - team/special events); falls back to the
 * single first_session_time path only when no descriptor has session_times.
 */
function extractSessionTimes(row: Record<string, unknown>): string[] {
  const descriptors = Array.isArray(row.race_time_descriptors) ? row.race_time_descriptors : [];
  const times: string[] = [];

  for (const d of descriptors as Record<string, unknown>[]) {
    const explicit = Array.isArray(d.session_times) ? d.session_times.filter((t): t is string => typeof t === "string") : [];
    if (explicit.length > 0) times.push(...explicit);
  }
  if (times.length > 0) return times;

  const startDate = pickString(row.start_date);
  const firstTime = pickString((descriptors[0] as any)?.first_session_time);
  if (startDate && firstTime) return [`${startDate}T${firstTime}Z`];

  return [];
}

/** Race-only duration - `race_time_limit` (minutes, confirmed live). Deliberately no
 * fallback to a week_end_time/start_date diff: that window includes practice and
 * qualifying time, which is exactly the bug this replaces (see plan report, Bug #2).
 * A lap-limited race with no time limit correctly comes back `undefined` rather than
 * a wrong number - existing UI already renders "—" for a missing duration. */
function deriveRaceLengthMinutes(row: Record<string, unknown>): number | undefined {
  return pickNumber(row.race_time_limit);
}

/** practiceLengthMinutes + qualifyLengthMinutes + warmupLengthMinutes - the shared
 * anchor for rebasing both stored condition-profile offsets (race-start-relative,
 * per the DB column's documented meaning) and forecast-hour slicing (the forecast's
 * own time_offset is weekend-relative, confirmed live via the `affects_session` flag
 * bracketing practice-through-race). 0 for an event with no practice/qualifying data -
 * makes every downstream offset calculation a no-op, same as today's behavior. */
export function raceStartOffsetMinutes(lengths: {
  practiceLengthMinutes?: number;
  qualifyLengthMinutes?: number;
  warmupLengthMinutes?: number;
}): number {
  return (lengths.practiceLengthMinutes ?? 0) + (lengths.qualifyLengthMinutes ?? 0) + (lengths.warmupLengthMinutes ?? 0);
}

/** All schedule entries (race weeks) for a given series, across whichever season
 * row(s) in the payload reference it - almost always exactly one for a genuine
 * special event, since those are one-off rather than recurring weekly. Flattened to
 * one row per real-world start-time slot (see extractSessionTimes) rather than one
 * per schedule entry, so a special event with multiple joinable times is fully
 * representable - a schedule with no resolvable slot times still emits exactly one
 * row (slotIndex 0, slotCount 1, scheduledStartTime undefined), matching today's
 * behavior for events without this data. */
export function extractSchedulesForSeries(payload: any, seriesId: string): ScheduleSession[] {
  const seasonRows = extractSeasonRows(payload).filter((row) => String(pickNumber(row.series_id) ?? "") === seriesId);
  const out: ScheduleSession[] = [];

  for (const seasonRow of seasonRows) {
    const seasonId = pickNumber(seasonRow.season_id);
    const schedules = Array.isArray(seasonRow.schedules) ? seasonRow.schedules : [];
    const teamSizeLimits = extractTeamSizeLimits(seasonRow);

    for (const s of schedules as Record<string, unknown>[]) {
      const track = s.track as any;
      const weather = s.weather as any;
      const weatherUrl = pickString(weather?.weather_url);
      const qualAttached = s.qual_attached !== false;

      const base = {
        seasonId: seasonId !== undefined ? String(seasonId) : "",
        raceWeekNum: pickNumber(s.race_week_num) ?? 0,
        scheduleName: pickString(s.schedule_name),
        trackName: pickString(track?.track_name),
        trackConfig: pickString(track?.config_name),
        specialEventType: pickNumber(s.special_event_type),
        practiceLengthMinutes: pickNumber(s.practice_length),
        qualifyLengthMinutes: qualAttached ? pickNumber(s.qualify_length) : undefined,
        warmupLengthMinutes: pickNumber(s.warmup_length),
        raceLengthMinutes: deriveRaceLengthMinutes(s),
        forecastAvailable: Boolean(weatherUrl),
        weatherUrl,
        forecastSummary: extractForecastSummary(s),
        ...teamSizeLimits,
        ...extractCarRegulationSummary(s),
      };

      const slotTimes = extractSessionTimes(s);
      if (slotTimes.length === 0) {
        out.push({ ...base, scheduledStartTime: undefined, slotIndex: 0, slotCount: 1 });
        continue;
      }

      slotTimes.forEach((t, i) => {
        out.push({ ...base, scheduledStartTime: t, slotIndex: i, slotCount: slotTimes.length });
      });
    }
  }

  return out;
}

export type ForecastHour = {
  timestamp: string;
  timeOffsetMinutes: number;
  isSunUp: boolean;
  airTempC?: number;
  cloudCoverPct?: number;
  precipChancePct?: number;
  windSpeed?: number;
};

/** Fetches the actual hourly forecast timeline a schedule entry's weather_url
 * points to - confirmed live: it's a pre-signed public S3 link, no Authorization
 * header needed (same two-step pattern the rest of the Data API uses, except the
 * signing is already done by the time this URL is handed to us). */
export async function fetchWeatherForecast(weatherUrl: string): Promise<ForecastHour[]> {
  const res = await fetch(weatherUrl);
  if (!res.ok) throw new Error(`Weather forecast fetch failed: ${res.status}`);
  const rows = (await res.json()) as any[];

  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      timestamp: pickString(r.timestamp) ?? "",
      timeOffsetMinutes: pickNumber(r.time_offset) ?? 0,
      isSunUp: Boolean(r.is_sun_up),
      // air_temp confirmed live as centi-degrees-Celsius (2593 -> 25.93degC for a
      // real June reading) - unrelated to the temp_units field seen elsewhere,
      // this file has no units field of its own.
      airTempC: pickNumber(r.air_temp) !== undefined ? (pickNumber(r.air_temp) as number) / 100 : undefined,
      cloudCoverPct: pickNumber(r.cloud_cover) !== undefined ? (pickNumber(r.cloud_cover) as number) / 10 : undefined,
      // precip_chance confirmed live as centi-percent (10000 -> 100.00%, 37 -> 0.37%) -
      // found via a real captured forecast where every hour showed 9990%+ and every
      // condition profile got wrongly marked "wet" (trackState's >50 threshold below
      // trips on nearly any raw value without this).
      precipChancePct: pickNumber(r.precip_chance) !== undefined ? (pickNumber(r.precip_chance) as number) / 100 : undefined,
      windSpeed: pickNumber(r.wind_speed),
    }))
    .filter((r) => r.timestamp);
}

export type DerivedConditionProfile = {
  label: string;
  windowStartMin: number;
  windowEndMin: number;
  airTempMin?: number;
  airTempMax?: number;
  trackState?: string;
  precipPct?: number;
};

/**
 * Buckets an hourly forecast timeline into Day/Dusk/Night/Dawn segments (PRD §6).
 * The raw data only has a boolean `is_sun_up`, not named phases, so this is a
 * heuristic, not a confirmed mapping: a `true` run is "Day"; a `false` run gets
 * its first hour labeled "Dusk", its last hour "Dawn", and the middle (if any)
 * "Night" - short `false` runs (<3 hours, e.g. a brief evening dip) stay a
 * single "Night" bucket rather than producing degenerate 0-length Dusk/Dawn
 * slivers. Only tested against a short live window (a few hours of one series'
 * forecast, not a full multi-day-cycle special event) - worth eyeballing
 * against a real 24h+ event's output once one is selectable.
 */
export function deriveConditionProfilesFromForecast(hours: ForecastHour[]): DerivedConditionProfile[] {
  const sorted = [...hours].sort((a, b) => a.timeOffsetMinutes - b.timeOffsetMinutes);
  if (sorted.length === 0) return [];

  type Run = { isSunUp: boolean; hours: ForecastHour[] };
  const runs: Run[] = [];
  for (const hour of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.isSunUp === hour.isSunUp) last.hours.push(hour);
    else runs.push({ isSunUp: hour.isSunUp, hours: [hour] });
  }

  function summarize(label: string, hours: ForecastHour[]): DerivedConditionProfile {
    const temps = hours.map((h) => h.airTempC).filter((t): t is number => t !== undefined);
    const precips = hours.map((h) => h.precipChancePct).filter((p): p is number => p !== undefined);
    return {
      label,
      windowStartMin: hours[0].timeOffsetMinutes,
      windowEndMin: hours[hours.length - 1].timeOffsetMinutes,
      airTempMin: temps.length ? Math.min(...temps) : undefined,
      airTempMax: temps.length ? Math.max(...temps) : undefined,
      trackState: precips.some((p) => p > 50) ? "wet" : "dry",
      precipPct: precips.length ? Math.round(Math.max(...precips)) : undefined,
    };
  }

  const profiles: DerivedConditionProfile[] = [];
  for (const run of runs) {
    if (run.isSunUp) {
      profiles.push(summarize("Day", run.hours));
      continue;
    }
    if (run.hours.length < 3) {
      profiles.push(summarize("Night", run.hours));
      continue;
    }
    profiles.push(summarize("Dusk", [run.hours[0]]));
    profiles.push(summarize("Night", run.hours.slice(1, -1)));
    profiles.push(summarize("Dawn", [run.hours[run.hours.length - 1]]));
  }

  return profiles;
}

type SessionPhaseLengths = {
  practiceLengthMinutes?: number;
  qualifyLengthMinutes?: number;
  warmupLengthMinutes?: number;
};

/** Practice/Qualifying/Warmup windows, weekend-relative (offset 0 = when practice
 * opens), in the order they run - whichever phases have a positive length. */
function buildPreRacePhases(lengths: SessionPhaseLengths): { label: string; startOffsetMinutes: number; endOffsetMinutes: number }[] {
  const phases: { label: string; startOffsetMinutes: number; endOffsetMinutes: number }[] = [];
  let cursor = 0;
  for (const [label, minutes] of [
    ["Practice", lengths.practiceLengthMinutes],
    ["Qualifying", lengths.qualifyLengthMinutes],
    ["Warmup", lengths.warmupLengthMinutes],
  ] as const) {
    if (minutes) {
      phases.push({ label, startOffsetMinutes: cursor, endOffsetMinutes: cursor + minutes });
      cursor += minutes;
    }
  }
  return phases;
}

/**
 * Practice/Qualifying/Warmup weather - flat (non day/night-split) summaries, one per
 * phase, matching hourly forecast samples whose implicit 60-minute bucket overlaps
 * that phase's weekend-relative window. Falls back to the single nearest hour when a
 * phase is shorter than the hourly sample spacing (e.g. an 8-minute Qualifying) so it
 * never comes back empty just because it doesn't span a full sample.
 *
 * Stored offsets are rebased to be race-start-relative (subtracting
 * raceStartOffsetMinutes), so they come out negative - e.g. Practice `[-38, -8]` for
 * the confirmed live example (30min practice, 8min qualifying, race starting at
 * offset 0). This matches event_condition_profiles's documented column meaning
 * ("offset from race start") and how Availability's conditionForOffset already
 * treats offsets - block offsets never go negative, so these rows simply never match
 * a driving block, which is correct: they're informational only, not part of the
 * race's own driver-rotation schedule.
 */
export function derivePreRacePhaseProfiles(hours: ForecastHour[], lengths: SessionPhaseLengths): DerivedConditionProfile[] {
  const sorted = [...hours].sort((a, b) => a.timeOffsetMinutes - b.timeOffsetMinutes);
  const raceStart = raceStartOffsetMinutes(lengths);
  const profiles: DerivedConditionProfile[] = [];

  for (const phase of buildPreRacePhases(lengths)) {
    let matches = sorted.filter((h) => h.timeOffsetMinutes < phase.endOffsetMinutes && h.timeOffsetMinutes + 60 > phase.startOffsetMinutes);
    if (matches.length === 0 && sorted.length > 0) {
      const mid = (phase.startOffsetMinutes + phase.endOffsetMinutes) / 2;
      matches = [[...sorted].sort((a, b) => Math.abs(a.timeOffsetMinutes - mid) - Math.abs(b.timeOffsetMinutes - mid))[0]];
    }
    if (matches.length === 0) continue;

    const temps = matches.map((h) => h.airTempC).filter((t): t is number => t !== undefined);
    const precips = matches.map((h) => h.precipChancePct).filter((p): p is number => p !== undefined);

    profiles.push({
      label: phase.label,
      windowStartMin: phase.startOffsetMinutes - raceStart,
      windowEndMin: phase.endOffsetMinutes - raceStart,
      airTempMin: temps.length ? Math.min(...temps) : undefined,
      airTempMax: temps.length ? Math.max(...temps) : undefined,
      trackState: precips.some((p) => p > 50) ? "wet" : "dry",
      precipPct: precips.length ? Math.round(Math.max(...precips)) : undefined,
    });
  }

  return profiles;
}

export type DriverLookupResult = { custId: string; name: string };

/**
 * Real-name driver lookup - confirmed live (2026-07-18): `/data/lookup/drivers?
 * search_term=` accepts a cust_id or partial name (per the Data API's own /data/doc
 * description), case-insensitive substring match against the full display name, capped at
 * 100 raw results server-side. Complements the app's local `drivers` table search
 * (functions/api/drivers/search.ts), which only knows about drivers who've already
 * appeared in a synced session - this reaches every real iRacing member, including ones
 * a team is adding to a lineup for the first time.
 */
export async function fetchDriverLookup(searchTerm: string, accessToken: string): Promise<DriverLookupResult[]> {
  const payload = await iracingDataGet<any>(`/data/lookup/drivers?search_term=${encodeURIComponent(searchTerm)}`, accessToken);
  const rows: any[] = Array.isArray(payload) ? payload : [];

  return rows
    .filter((r) => r?.profile_disabled !== true)
    .map((r) => ({ custId: String(pickNumber(r?.cust_id) ?? ""), name: pickString(r?.display_name) ?? "" }))
    .filter((r) => r.custId && r.name)
    .slice(0, 20);
}
