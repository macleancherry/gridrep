import { iracingDataGet } from "./iracing";
import { fetchSubsessionResult, extractSessionHeader } from "./plannerIracing";
import { ingestPlannerSubsession } from "./plannerIngest";

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

export async function discoverAndSyncRecentSessionAtTrack(
  DB: any,
  custId: string,
  trackName: string,
  viewerUserId: string,
  accessToken: string
): Promise<void> {
  try {
    const candidateIds = await discoverRecentSubsessionIds(custId, accessToken, MAX_CANDIDATES_TO_CHECK);

    for (const subsessionId of candidateIds) {
      let header: { track_name?: string };
      try {
        const payload = await fetchSubsessionResult(subsessionId, accessToken);
        header = extractSessionHeader(payload);
      } catch {
        continue; // this candidate errored - try the next one rather than failing the whole search
      }

      if (!header.track_name || !tracksMatch(header.track_name, trackName)) continue;

      const summary = await ingestPlannerSubsession({ env: { DB } }, subsessionId, { viewerUserId, accessToken });
      await setStatus(
        DB,
        custId,
        trackName,
        "found",
        subsessionId,
        `Synced ${summary.lapsIngested} laps from a session at ${header.track_name}${summary.remainingJobs > 0 ? " (partial - large session)" : ""}.`
      );
      return;
    }

    await setStatus(DB, custId, trackName, "not_found", null, "No recent session found at this track in the driver's last races.");
  } catch (err: any) {
    await setStatus(DB, custId, trackName, "error", null, err?.message ?? "Search failed.");
  }
}
