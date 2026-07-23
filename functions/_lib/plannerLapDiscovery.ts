import { iracingDataGet } from "./iracing";
import { fetchSubsessionResult, extractSessionHeader } from "./plannerIracing";
import { ingestPlannerSubsession } from "./plannerIngest";
import { computeAndStoreOneDriverProfile } from "./plannerDriverProfile";

/**
 * Background "find a recent session at this track" search - fires from race-plans/
 * :planId/lineup.ts's PUT via context.waitUntil() when a driver is newly added, so the
 * organiser doesn't have to know or paste a subsession ID themselves. Most drivers will
 * have run at least one practice lap at a track before committing to race there, so this
 * is deliberately optimistic: check a driver's most recent races/practices, stop at the
 * first one that was actually at this track, and sync it immediately.
 *
 * Deliberately NOT a full port of functions/_lib/recent.ts's refreshRecentRacesForMember
 * (that function serves a different, heavier use case - bulk-importing a whole window of
 * races into the main site's own session cache across every verified user's token). This
 * only needs a handful of the driver's newest races checked against one specific track,
 * using the one access token the caller already has on hand.
 */

const MAX_CANDIDATES_TO_CHECK = 15;
const MAX_FALLBACK_CANDIDATES = 25;
// iRacing's own hard cap on search_series/search_hosted date ranges (confirmed live:
// a wider range 400s with "Time ranges are limited to 90 days.").
const SEARCH_WINDOW_DAYS = 90;
// How far back to walk in 90-day windows when member_recent_races (capped at the
// member's last 10 official races - confirmed live) doesn't cover this track. 4 windows
// is a year of history - generous enough to catch "raced here a few months ago, then
// did a bunch of other races since" without the background job running indefinitely.
const FALLBACK_WINDOWS = 4;

type RecentRaceRow = Record<string, unknown>;

function extractRaceRows(payload: unknown): RecentRaceRow[] {
  const data = payload as any;
  return (
    (Array.isArray(data) && data) ||
    (Array.isArray(data?.races) && data.races) ||
    (Array.isArray(data?.recent_races) && data.recent_races) ||
    (Array.isArray(data?.results) && data.results) ||
    []
  );
}

function extractSubsessionId(row: Record<string, unknown>): string | null {
  const value = row.subsession_id ?? row.subsessionId ?? row.subsessionid ?? row.sub_session_id ?? row.subSessionId ?? row.session_id;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

/** Newest-first walk collecting up to `maxIds` distinct subsession ids belonging to the
 * requested member - a leaner, single-pass version of recent.ts's collectSubsessionIds
 * (BFS via shift(), not a reversing pop() stack, to preserve iRacing's own newest-first
 * ordering as closely as a generic payload-shape walk reasonably can). */
function collectSubsessionIds(payload: unknown, requestedMemberId: string, maxIds: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const queue: unknown[] = [payload];

  while (queue.length > 0 && ids.length < maxIds) {
    const value = queue.shift();
    if (!value) continue;

    if (Array.isArray(value)) {
      for (const item of value) queue.push(item);
      continue;
    }
    if (typeof value !== "object") continue;

    const row = value as Record<string, unknown>;
    const rowMember = row.cust_id ?? row.customer_id ?? row.customerId ?? row.iracing_member_id ?? row.member_id ?? row.memberId;
    const subId = extractSubsessionId(row);
    if (subId && !seen.has(subId) && (rowMember == null || String(rowMember) === requestedMemberId)) {
      seen.add(subId);
      ids.push(subId);
      if (ids.length >= maxIds) break;
    }

    for (const nested of Object.values(row)) {
      if (nested && (Array.isArray(nested) || typeof nested === "object")) queue.push(nested);
    }
  }

  return ids;
}

async function discoverRecentSubsessionIds(custId: string, accessToken: string, limit: number): Promise<string[]> {
  const queryPaths = [
    `/data/stats/member_recent_races?cust_id=${encodeURIComponent(custId)}`,
    `/data/stats/member_recent_races?customer_id=${encodeURIComponent(custId)}`,
  ];

  let gotAnyResponse = false;
  let lastErr: unknown = null;

  for (const path of queryPaths) {
    try {
      const payload = await iracingDataGet<any>(path, accessToken);
      gotAnyResponse = true;
      const ids = collectSubsessionIds(payload, custId, limit);
      if (ids.length > 0) return ids;
      // A response with rows for someone else but none for this member is still a
      // successful call - only fall through to the next path on an empty/unusable payload.
      if (extractRaceRows(payload).length > 0) return [];
    } catch (err) {
      lastErr = err;
    }
  }

  // Every path threw - this is "the search couldn't run" (bad token, iRacing unreachable),
  // not "genuinely no recent races" - the caller needs to tell those two apart so an
  // organiser sees "search failed" rather than a misleading "nothing found here".
  if (!gotAnyResponse && lastErr) throw lastErr;

  return [];
}

function encodePath(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`https://members-ng.iracing.com${path}`);
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue;
    url.searchParams.set(key, String(raw));
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** search_series/search_hosted return their actual rows as pre-signed S3 chunk files
 * (confirmed live - {type, data: {chunk_info: {base_download_url, chunk_file_names}}}),
 * not inline like member_recent_races - the rows aren't visible until these are fetched
 * too. Same shape recent.ts's own getChunkInfo/fetchChunkRows already handle for the
 * site's bulk importer. */
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

async function fetchChunkRows(payload: unknown, maxChunkFiles: number): Promise<RecentRaceRow[]> {
  const chunkInfo = getChunkInfo(payload);
  if (!chunkInfo) return [];

  const rows: RecentRaceRow[] = [];
  for (const fileName of chunkInfo.chunkFileNames.slice(0, maxChunkFiles)) {
    try {
      const res = await fetch(`${chunkInfo.baseDownloadUrl}${fileName}`);
      if (!res.ok) continue;
      const parsed = await res.json();
      if (Array.isArray(parsed)) rows.push(...(parsed as RecentRaceRow[]));
      else if (parsed && typeof parsed === "object") rows.push(...extractRaceRows(parsed));
    } catch {
      // Best-effort - a bad chunk fetch just means fewer candidates this round.
    }
  }
  return rows;
}

/**
 * member_recent_races only ever covers a member's last 10 *official* races (confirmed
 * live - a driver who's raced 10+ times anywhere since their last visit to this specific
 * track, or who only ever ran it in a hosted/league session, comes back with zero
 * candidates from discoverRecentSubsessionIds even though real relevant laps exist).
 * This is exactly the gap the site's own bulk importer (recent.ts) already solves with a
 * date-windowed search_series + search_hosted fallback - mirrored here, just scoped down
 * to only run when the fast path above found nothing, since it costs several extra
 * iRacing API calls per driver.
 */
async function discoverFallbackSubsessionIds(
  custId: string,
  accessToken: string,
  trackName: string,
  exclude: Set<string>,
  limit: number
): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set(exclude);
  const nowMs = Date.now();

  for (let window = 0; window < FALLBACK_WINDOWS && found.length < limit; window++) {
    const rangeEndMs = nowMs - window * SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const rangeBeginMs = rangeEndMs - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const paths = [
      encodePath("/data/results/search_series", {
        cust_id: custId,
        finish_range_begin: new Date(rangeBeginMs).toISOString(),
        finish_range_end: new Date(rangeEndMs).toISOString(),
        official_only: false,
      }),
      // Hosted/league sessions never show up in member_recent_races or search_series -
      // only worth checking the most recent window, since a coordinator's own hosted
      // practice/race is far more likely to be recent than a year-old one.
      ...(window === 0
        ? [
            encodePath("/data/results/search_hosted", {
              cust_id: custId,
              finish_range_begin: new Date(rangeBeginMs).toISOString(),
              finish_range_end: new Date(rangeEndMs).toISOString(),
            }),
          ]
        : []),
    ];

    for (const path of paths) {
      try {
        const payload = await iracingDataGet<any>(path, accessToken);
        const rows = await fetchChunkRows(payload, 5);

        // Filter to this track BEFORE extracting ids - each window can return 50-200+
        // rows across every track the driver's touched, and the most recent window is
        // always the biggest. Collecting ids in row order and capping globally would let
        // that one crowded recent window exhaust the whole candidate budget before the
        // search ever reached the older window this track's actual sessions are in - the
        // track name is already right there on each row (row.track.track_name), so
        // matching against it directly avoids ever needing to look at an unrelated track.
        for (const row of rows) {
          const r = row as Record<string, unknown>;
          const rowMember = r.cust_id ?? r.customer_id ?? r.customerId ?? r.iracing_member_id ?? r.member_id ?? r.memberId;
          if (rowMember != null && String(rowMember) !== custId) continue;

          const rowTrack = (r.track as any)?.track_name;
          if (typeof rowTrack !== "string" || !tracksMatch(rowTrack, trackName)) continue;

          const id = extractSubsessionId(r);
          if (id && !seen.has(id)) {
            seen.add(id);
            found.push(id);
          }
        }
      } catch {
        // Best-effort only - a failed fallback window shouldn't turn an honest
        // "not found" into a misleading "search error" when the fast path already
        // succeeded (just came up empty).
      }
      if (found.length >= limit) break;
      await sleep(200);
    }
  }

  return found;
}

/** Loose match, tolerant of minor config-string differences ("Circuit de Spa-
 * Francorchamps" vs "Spa-Francorchamps - Grand Prix") - a false negative just means the
 * organiser falls back to the manual paste-ID box, never a wrong sync. */
function tracksMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function setStatus(
  DB: any,
  custId: string,
  trackName: string,
  status: "searching" | "found" | "not_found" | "error",
  subsessionId: string | null,
  message: string | null
): Promise<void> {
  await DB.prepare(
    `INSERT INTO driver_recent_session_search (cust_id, track_name, status, subsession_id, message, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cust_id, track_name) DO UPDATE SET
       status = excluded.status, subsession_id = excluded.subsession_id,
       message = excluded.message, updated_at = excluded.updated_at`
  )
    .bind(custId, trackName, status, subsessionId, message, new Date().toISOString())
    .run();
}

/** Checks one batch of candidate subsessions against the target track, syncing and
 * setting a terminal status on the first real match. Returns true if it handled the
 * search (found laps, or found the track but couldn't fetch laps) - false means none of
 * these candidates matched, and the caller should either try a wider batch or give up. */
async function tryCandidates(
  context: any,
  DB: any,
  custId: string,
  trackName: string,
  trackConfig: string | null,
  carId: number | null,
  carClassCarIds: number[] | null,
  viewerUserId: string,
  accessToken: string,
  garage61TeamSlug: string | null,
  candidateIds: string[]
): Promise<boolean> {
  for (const subsessionId of candidateIds) {
    let header: { track_name?: string };
    try {
      const payload = await fetchSubsessionResult(subsessionId, accessToken);
      header = extractSessionHeader(payload);
    } catch {
      continue; // this candidate errored - try the next one rather than failing the whole search
    }

    if (!header.track_name || !tracksMatch(header.track_name, trackName)) continue;

    let summary: Awaited<ReturnType<typeof ingestPlannerSubsession>>;
    try {
      summary = await ingestPlannerSubsession(
        { env: { DB } },
        subsessionId,
        { viewerUserId, accessToken, priorityCustId: custId }
      );
    } catch {
      // Right track, but this specific subsession isn't ingestable at all (e.g. a pure
      // Open Practice room with no qualifying/race block - common once the fallback
      // search below widens past official races into every session type at a track).
      // One bad candidate shouldn't abort the search when other real sessions at this
      // same track are still further down the list - keep checking them.
      continue;
    }

    // A large team session's own job queue can span far more than one batch - without
    // prioritizing this driver's own job (priorityCustId above), a session with hundreds
    // of participants could report an aggregate "N laps synced" success while never
    // actually reaching this specific driver's job at all. Confirm their own laps really
    // landed before calling this "found" rather than trusting the aggregate count.
    const targetLaps = await DB.prepare(`SELECT COUNT(*) as n FROM planner_iracing_laps WHERE subsession_id = ? AND cust_id = ?`)
      .bind(subsessionId, custId)
      .first<{ n: number }>();

    if ((targetLaps?.n ?? 0) > 0) {
      await setStatus(
        DB,
        custId,
        trackName,
        "found",
        subsessionId,
        `Synced ${targetLaps!.n} of this driver's own laps from a session at ${header.track_name}.`
      );
      await computeProfileQuietly(context, DB, custId, trackName, trackConfig, carId, carClassCarIds, garage61TeamSlug);
      return true;
    }

    const targetFailure = summary.driverFailures.find((f) => f.custId === custId);
    if (targetFailure) {
      await setStatus(
        DB,
        custId,
        trackName,
        "error",
        subsessionId,
        `Found a session at this track but could not fetch this driver's own laps: ${targetFailure.message}`
      );
      return true;
    }

    // Right track, but this driver has no usable laps in it (e.g. they didn't complete
    // any laps before a DNF) - keep checking older candidates rather than reporting a
    // false "found".
  }

  return false;
}

export async function discoverAndSyncRecentSessionAtTrack(
  context: any,
  DB: any,
  custId: string,
  trackName: string,
  trackConfig: string | null,
  carId: number | null,
  carClassCarIds: number[] | null,
  viewerUserId: string,
  accessToken: string,
  garage61TeamSlug: string | null
): Promise<void> {
  try {
    const recentIds = await discoverRecentSubsessionIds(custId, accessToken, MAX_CANDIDATES_TO_CHECK);
    if (
      await tryCandidates(context, DB, custId, trackName, trackConfig, carId, carClassCarIds, viewerUserId, accessToken, garage61TeamSlug, recentIds)
    ) {
      return;
    }

    // member_recent_races only covers the last 10 official races (confirmed live) - a
    // driver who's raced elsewhere since their last visit to this track, or who only ever
    // ran it in a non-championship/hosted session, needs the wider date-windowed search
    // below rather than being reported as having no relevant experience at all.
    const fallbackIds = await discoverFallbackSubsessionIds(custId, accessToken, trackName, new Set(recentIds), MAX_FALLBACK_CANDIDATES);
    if (
      fallbackIds.length > 0 &&
      (await tryCandidates(context, DB, custId, trackName, trackConfig, carId, carClassCarIds, viewerUserId, accessToken, garage61TeamSlug, fallbackIds))
    ) {
      return;
    }

    await setStatus(
      DB,
      custId,
      trackName,
      "not_found",
      null,
      `No recent session found at this track, including a wider year-long search of official, non-championship, and hosted races. [diag: recent=${recentIds.length} fallback=${fallbackIds.length}]`
    );
    // Still worth a compute pass even with no synced laps - stores a definitive
    // "no_laps_at_track" profile row (fuel may still resolve from Garage 61 alone) instead
    // of leaving the Lineup/Stints pages with nothing to show but the search status.
    await computeProfileQuietly(context, DB, custId, trackName, trackConfig, carId, carClassCarIds, garage61TeamSlug);
  } catch (err: any) {
    await setStatus(DB, custId, trackName, "error", null, err?.message ?? "Search failed.");
  }
}

/** Best-effort profile compute at the end of a background search - never lets a compute
 *  failure (e.g. a Garage 61 hiccup) mask the lap-search result that already landed. */
async function computeProfileQuietly(
  context: any,
  DB: any,
  custId: string,
  trackName: string,
  trackConfig: string | null,
  carId: number | null,
  carClassCarIds: number[] | null,
  garage61TeamSlug: string | null
): Promise<void> {
  try {
    await computeAndStoreOneDriverProfile(context, DB, {
      custId,
      trackName,
      trackConfig,
      carId,
      carClassCarIds,
      conditionProfileId: null,
      tempMid: null,
      garage61TeamSlug,
    });
  } catch {
    // Best-effort only - the frontend's polling will just keep showing "not computed yet".
  }
}
