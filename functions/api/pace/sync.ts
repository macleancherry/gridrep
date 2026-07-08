import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { searchHostedSessionsForLeague, extractSubsessionIds, describeIracingError } from "../../_lib/paceIracing";
import { ingestPaceSubsession, PaceIngestError } from "../../_lib/paceIngest";
import { json, jsonError } from "../../_lib/httpJson";

// Cloudflare Workers caps subrequests per invocation, and a single
// subsession's own lap ingestion can already use most of that budget for a
// large field - so this only fully attempts one subsession per call, same
// as the per-subsession batching in paceIngest.ts. The frontend loops this
// endpoint (mirroring the Pull flow) until nothing's left.
const MAX_SESSIONS_ATTEMPTED_PER_RUN = 1;

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
    sessionsRemaining: 0,
    failures: [] as Array<{ leagueId: string; subsessionId?: string; message: string }>,
    emptySearchSamples: [] as Array<{ leagueId: string; sample: string }>,
  };

  let attemptedThisRun = 0;

  for (const league of leagues.results ?? []) {
    summary.leaguesChecked += 1;

    let subsessionIds: string[] = [];
    try {
      const searchPayload = await searchHostedSessionsForLeague(league.leagueId, league.lastSyncedAt ?? undefined, accessToken, {
        hostCustId: league.hostCustId,
        sessionNameFilter: league.sessionNameFilter,
      });
      subsessionIds = await extractSubsessionIds(searchPayload);
      if (subsessionIds.length === 0) {
        summary.emptySearchSamples.push({ leagueId: league.leagueId, sample: JSON.stringify(searchPayload).slice(0, 800) });
      }
    } catch (err: any) {
      summary.failures.push({ leagueId: league.leagueId, message: `Search failed: ${describeIracingError(err)}` });
      continue;
    }

    summary.sessionsFound += subsessionIds.length;

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

    if (attemptedThisRun >= MAX_SESSIONS_ATTEMPTED_PER_RUN) break;
  }

  return json({ ok: true, ...summary });
}
