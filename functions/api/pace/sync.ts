import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { searchHostedSessionsForLeague, extractSubsessionIds, describeIracingError } from "../../_lib/paceIracing";
import { ingestPaceSubsession, PaceIngestError } from "../../_lib/paceIngest";
import { json, jsonError } from "../../_lib/httpJson";

// Cloudflare Workers caps subrequests per invocation, and a single
// subsession's own lap ingestion can already use most of that budget for a
// large field - so this only fully *ingests* one subsession per call, same
// as the per-subsession batching in paceIngest.ts. Searching is cheap by
// comparison (one iRacing call per league), so every followed league is
// still searched every call regardless of this cap - only the ingest step
// is rationed. This matters: if search stopped early too, a league further
// down the list could sit with a real backlog the frontend never finds out
// about, because its own "remaining" count would never be reported (see
// the loop below - no break after a league is done, only after ingesting).
// The frontend loops this endpoint (mirroring the Pull flow) until nothing
// reported here is left.
const MAX_SESSIONS_ATTEMPTED_PER_RUN = 1;

// A league that rotates who hosts each round (common - one person schedules
// week 1, someone else week 3, etc.) can't be caught by a single
// host_cust_id: iRacing's search_hosted only ever matches sessions that
// exact person hosted. Storing a comma-separated list lets a league be
// followed under several hosts at once - each gets its own search_hosted
// call below, unioned together, rather than requiring one host to have
// created every session.
function parseMultiValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function incompleteSubsessionIds(DB: any, subsessionIds: string[]): Promise<string[]> {
  if (subsessionIds.length === 0) return [];
  const placeholders = subsessionIds.map(() => "?").join(",");
  const rows = await DB.prepare(
    `SELECT subsession_id as subsessionId FROM pace_subsessions WHERE subsession_id IN (${placeholders}) AND laps_complete = 1`
  )
    .bind(...subsessionIds)
    .all<{ subsessionId: string }>();
  const completeSet = new Set((rows.results ?? []).map((r) => r.subsessionId));
  return subsessionIds.filter((id) => !completeSet.has(id));
}

// A subsession this league's search just found can already be fully
// ingested (laps_complete = 1) without ever having been linked to this
// league - e.g. it was pulled directly by ID (the "Pull a session" flow,
// or an earlier debugging session) before this league was ever followed.
// incompleteSubsessionIds filters those out entirely (there's nothing left
// to ingest), and ingestPaceSubsession's own "already complete" fast path
// never touches league_id either - so without this, a search that
// genuinely finds the right session can still leave it permanently
// invisible to this league's race list. Only fills in a NULL league_id,
// same as the ON CONFLICT clause in paceIngest.ts - never reassigns one
// that's already set.
async function attachAlreadyCompleteSubsessions(DB: any, subsessionIds: string[], leagueId: string): Promise<number> {
  if (subsessionIds.length === 0) return 0;
  const placeholders = subsessionIds.map(() => "?").join(",");
  const result = await DB.prepare(
    `UPDATE pace_subsessions SET league_id = ? WHERE subsession_id IN (${placeholders}) AND laps_complete = 1 AND league_id IS NULL`
  )
    .bind(leagueId, ...subsessionIds)
    .run();
  return result?.meta?.changes ?? 0;
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to sync." });
  }

  const { DB } = context.env;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  const leagues = await DB.prepare(
    `SELECT league_id as leagueId, name, last_synced_at as lastSyncedAt,
            host_cust_id as hostCustId, session_name_filter as sessionNameFilter
     FROM pace_leagues`
  ).all<any>();

  const summary = {
    leaguesChecked: 0,
    sessionsFound: 0,
    sessionsIngested: 0,
    sessionsAttached: 0,
    sessionsRemaining: 0,
    failures: [] as Array<{ leagueId: string; subsessionId?: string; message: string }>,
    emptySearchSamples: [] as Array<{ leagueId: string; sample: string }>,
  };

  let attemptedThisRun = 0;

  for (const league of leagues.results ?? []) {
    summary.leaguesChecked += 1;

    // Each host cust_id and each session-name filter is its own independent
    // search_hosted call (iRacing only accepts one of each at a time) -
    // union everything they find rather than requiring a single filter to
    // catch every session this league has ever had. The league's own
    // iRacing name is always tried too, on top of whatever cust_ids/filters
    // were explicitly configured - a free extra net that needs no input
    // from whoever followed the league, for the (common) case where a host
    // actually does put the league's name in the session title.
    const hostCustIds = parseMultiValue(league.hostCustId);
    // league.name is one value, not a comma-separated list like the other
    // two fields - added directly rather than through parseMultiValue so a
    // comma in the league's actual name (rare, but possible) doesn't get
    // wrongly split into multiple search terms.
    const leagueName = typeof league.name === "string" ? league.name.trim() : "";
    const sessionNameFilters = Array.from(new Set([...parseMultiValue(league.sessionNameFilter), ...(leagueName ? [leagueName] : [])]));
    const searchAttempts: Array<{ hostCustId?: string; sessionNameFilter?: string }> = [
      ...hostCustIds.map((hostCustId) => ({ hostCustId })),
      ...sessionNameFilters.map((sessionNameFilter) => ({ sessionNameFilter })),
    ];

    const subsessionIdSet = new Set<string>();
    let anySearchSucceeded = false;
    for (const filter of searchAttempts) {
      try {
        const searchPayload = await searchHostedSessionsForLeague(league.leagueId, league.lastSyncedAt ?? undefined, accessToken, filter);
        anySearchSucceeded = true;
        const ids = await extractSubsessionIds(searchPayload);
        ids.forEach((id) => subsessionIdSet.add(id));
        if (ids.length === 0) {
          summary.emptySearchSamples.push({
            leagueId: league.leagueId,
            sample: `${filter.hostCustId ? `host_cust_id=${filter.hostCustId}` : `session_name=${filter.sessionNameFilter}`}: ${JSON.stringify(searchPayload).slice(0, 600)}`,
          });
        }
      } catch (err: any) {
        summary.failures.push({
          leagueId: league.leagueId,
          message: `Search failed (${filter.hostCustId ? `host_cust_id=${filter.hostCustId}` : `session_name=${filter.sessionNameFilter}`}): ${describeIracingError(err)}`,
        });
      }
    }

    // Only skip this league's ingest step entirely if every search attempt
    // failed outright - a partial failure (one host's search errored but
    // another succeeded) should still process whatever was actually found.
    if (!anySearchSucceeded) continue;

    const subsessionIds = Array.from(subsessionIdSet);

    summary.sessionsFound += subsessionIds.length;
    summary.sessionsAttached += await attachAlreadyCompleteSubsessions(DB, subsessionIds, league.leagueId);

    const runStartedAt = new Date().toISOString();
    const pendingIds = await incompleteSubsessionIds(DB, subsessionIds);

    for (const subsessionId of pendingIds) {
      if (attemptedThisRun >= MAX_SESSIONS_ATTEMPTED_PER_RUN) break;
      attemptedThisRun += 1;

      try {
        await ingestPaceSubsession(context, subsessionId, {
          leagueId: league.leagueId,
          viewerUserId: viewer.user!.id,
          accessToken,
        });
      } catch (err: any) {
        const message = err instanceof PaceIngestError ? err.message : (err?.message ?? String(err));
        summary.failures.push({ leagueId: league.leagueId, subsessionId, message });
      }
    }

    // Re-check actual DB state rather than tracking it inline - a subsession
    // can take several calls of its own to finish (large field), so "did we
    // attempt it" doesn't mean "is it done".
    const stillPendingIds = await incompleteSubsessionIds(DB, subsessionIds);
    summary.sessionsIngested += pendingIds.length - stillPendingIds.length;
    summary.sessionsRemaining += stillPendingIds.length;

    // Only advance the marker once this league has nothing left pending -
    // advancing early (e.g. just because 0 *new* sessions were attempted)
    // would shrink the search window before the backlog is actually cleared.
    if (stillPendingIds.length === 0) {
      await DB.prepare(`UPDATE pace_leagues SET last_synced_at = ? WHERE league_id = ?`)
        .bind(runStartedAt, league.leagueId)
        .run();
    }

    // No break here - every league still gets searched and its pending
    // count added to the summary this call, even once the ingest budget
    // above is spent. Only the ingest loop itself rations attempts.
  }

  return json({ ok: true, ...summary });
}
