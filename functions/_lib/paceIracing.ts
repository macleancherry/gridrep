import { iracingDataGet } from "./iracing";

/**
 * Thin wrappers around the iRacing Data API endpoints Pace needs, plus
 * defensive extraction helpers (payload shapes vary by wrapper/version -
 * same tolerance-for-uncertainty approach already used in
 * functions/api/iracing/session/[subsessionId]/import.ts).
 */

export type SimSessionInfo = {
  simsessionNumber: number;
  type: "qualifying" | "race";
  custIds: string[];
};

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

  // Community-documented enum values; used only as a last resort fallback.
  const type = pickNumber(sr?.simsession_type);
  if (type === 6) return "race";
  if (type === 5) return "qualifying";

  return null;
}

/** Scan every sim-session block for cust_id -> display_name pairs. */
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

export async function fetchSubsessionResult(subsessionId: string, accessToken: string): Promise<any> {
  return iracingDataGet<any>(
    `/data/results/get?subsession_id=${encodeURIComponent(subsessionId)}&include_licenses=true`,
    accessToken
  );
}

/**
 * Identify qualifying/race sim-sessions in a subsession result payload, and
 * which cust_ids participated in each - practice/warmup blocks are ignored,
 * matching the PRD's driving use case (qualifying + race only).
 */
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

/**
 * Normalize a /data/results/lap_data payload into flat lap rows. Exact field
 * names have not been confirmed against a live payload in this environment
 * (see PRD §6/§11 spike step) - this tries the plausible shapes defensively,
 * same approach as extractParticipants() in the session import route.
 */
export function extractLapRows(lapDataPayload: any): Array<Record<string, unknown>> {
  const rows: any[] =
    (Array.isArray(lapDataPayload) && lapDataPayload) ||
    (Array.isArray(lapDataPayload?.laps) && lapDataPayload.laps) ||
    (Array.isArray(lapDataPayload?.lap_data) && lapDataPayload.lap_data) ||
    (Array.isArray(lapDataPayload?.results) && lapDataPayload.results) ||
    [];

  return rows.filter((r) => r && typeof r === "object");
}

export function normalizeLapTimeMs(row: Record<string, unknown>): number | null {
  const raw = pickNumber(
    row.lap_time ?? row.lapTime ?? row.lap_time_ms ?? row.lapTimeMs ?? row.time
  );
  if (raw === undefined) return null;

  // iRacing commonly reports lap times in ten-thousandths of a second (e.g.
  // irsdk-style "lap_time" as an integer). Treat very large integers as such;
  // otherwise assume the value is already milliseconds or seconds-as-float.
  if (raw > 100_000) return Math.round(raw / 10); // e.g. 123456 (0.0001s units) -> ms
  if (raw > 1000) return Math.round(raw); // already ms
  return Math.round(raw * 1000); // seconds as float
}

export function extractLapNumber(row: Record<string, unknown>): number | undefined {
  return pickNumber(row.lap_number ?? row.lapNumber ?? row.lap);
}

export async function fetchLapData(
  subsessionId: string,
  custId: string,
  simsessionNumber: number,
  accessToken: string
): Promise<any> {
  const params = new URLSearchParams({
    subsession_id: subsessionId,
    cust_id: custId,
    simsession_number: String(simsessionNumber),
  });
  return iracingDataGet<any>(`/data/results/lap_data?${params.toString()}`, accessToken);
}

export async function getLeagueInfo(leagueId: string, accessToken: string): Promise<any> {
  return iracingDataGet<any>(`/data/league/get?league_id=${encodeURIComponent(leagueId)}`, accessToken);
}

export function extractLeagueName(payload: any): string | undefined {
  return pickString(payload?.league_name) ?? pickString(payload?.name);
}

/**
 * Search hosted sessions for a league since a given ISO timestamp. Mirrors
 * the already-working search_hosted call in functions/_lib/recent.ts (there
 * scoped by cust_id; here scoped by league_id). Confirmed live: this
 * endpoint 400s if no date range is supplied at all, so a range is always
 * sent - defaulting to a 90-day lookback (same window recent.ts uses) on a
 * league's first sync, when there is no prior last_synced_at marker.
 */
export async function searchHostedSessionsForLeague(
  leagueId: string,
  sinceIso: string | undefined,
  accessToken: string
): Promise<any> {
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    league_id: leagueId,
    finish_range_begin: sinceIso ?? ninetyDaysAgoIso,
    finish_range_end: new Date().toISOString(),
  });
  return iracingDataGet<any>(`/data/results/search_hosted?${params.toString()}`, accessToken);
}

export function extractSubsessionIds(payload: any): string[] {
  const ids = new Set<string>();
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

  return Array.from(ids);
}
