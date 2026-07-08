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

/**
 * iRacingHttpError's default .message only carries the HTTP status, which
 * hides the actual reason iRacing rejected the request (e.g. a missing/bad
 * parameter). Surface the raw response body (truncated) so failures are
 * diagnosable from the sync/ingest summary alone, without server log access.
 */
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

  // Community-documented enum values; used only as a last resort fallback.
  const type = pickNumber(sr?.simsession_type);
  if (type === 6) return "race";
  if (type === 5) return "qualifying";

  return null;
}

/** Diagnostic-only: summarize what sim-session blocks a payload actually has, for error messages. */
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

/**
 * Normalize a /data/results/lap_data payload into flat lap rows. Confirmed
 * live: the top-level payload is a summary (session_info + best-lap stats),
 * not the actual laps - the real per-lap array lives behind the same
 * chunk_info + base_download_url indirection as search_hosted (see
 * extractSubsessionIds above). The direct-shape check stays as a fallback
 * in case a small session ever returns laps inline.
 */
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
  // -1 is iRacing's confirmed sentinel for "no time" (out-laps, invalidated
  // laps) - a real lap_time is never negative, so map any negative value to
  // null rather than deriving a nonsensical negative millisecond figure.
  if (raw === undefined || raw < 0) return null;

  // Confirmed live: lap_time is reported in ten-thousandths of a second
  // (e.g. 1186863 -> 118.6863s, a real Watkins Glen lap). Treat very large
  // integers as such; otherwise assume the value is already milliseconds or
  // seconds-as-float (kept as a fallback for any other shape this endpoint
  // might return under a different wrapper/version).
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

/**
 * Search hosted sessions for a league since a given ISO timestamp. Mirrors
 * the already-working search_hosted call in functions/_lib/recent.ts (there
 * scoped by cust_id; here scoped by league_id). Confirmed live: this
 * endpoint 400s unless a "primary filter" (host, driver, team, or session
 * name) is also included - league_id alone is only a secondary filter. The
 * caller must supply at least one of hostCustId/sessionNameFilter (enforced
 * when a league is followed, see functions/api/pace/leagues.ts).
 */
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

/**
 * List-returning endpoints like search_hosted often don't inline their
 * results - they point at a chunked S3 download (payload.data.chunk_info),
 * the same pattern functions/_lib/recent.ts already has to follow for
 * member_recent_races/search_series. Without this, a successful search with
 * real matches would still report 0 subsessions found.
 */
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
