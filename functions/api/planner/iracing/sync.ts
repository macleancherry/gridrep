import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { searchHostedSessionsForLeague, extractSubsessionIds, describeIracingError } from "../../../_lib/plannerIracing";
import { ingestPlannerSubsession, PlannerIngestError } from "../../../_lib/plannerIngest";
import { json, jsonError } from "../../../_lib/httpJson";

// Same one-subsession-per-call cap as Pace's /api/pace/sync, for the same reason:
// Cloudflare Workers caps subrequests per invocation, and a single subsession's own
// lap ingestion can already use most of that budget for a large field.
const MAX_SESSIONS_ATTEMPTED_PER_RUN = 1;

async function incompleteSubsessionIds(DB: any, subsessionIds: string[]): Promise<string[]> {
  if (subsessionIds.length === 0) return [];
  const placeholders = subsessionIds.map(() => "?").join(",");
  const rows = await DB.prepare(
    `SELECT subsession_id as subsessionId FROM planner_iracing_subsessions WHERE subsession_id IN (${placeholders}) AND laps_complete = 1`
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
     FROM planner_iracing_leagues`
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
        await ingestPlannerSubsession(context, subsessionId, {
          leagueId: league.leagueId,
          viewerUserId: viewer.user!.id,
          accessToken,
        });
      } catch (err: any) {
        const message = err instanceof PlannerIngestError ? err.message : (err?.message ?? String(err));
        summary.failures.push({ leagueId: league.leagueId, subsessionId, message });
      }
    }

    const stillPendingIds = await incompleteSubsessionIds(DB, subsessionIds);
    summary.sessionsIngested += pendingIds.length - stillPendingIds.length;
    summary.sessionsRemaining += stillPendingIds.length;

    if (stillPendingIds.length === 0) {
      await DB.prepare(`UPDATE planner_iracing_leagues SET last_synced_at = ? WHERE league_id = ?`)
        .bind(runStartedAt, league.leagueId)
        .run();
    }

    if (attemptedThisRun >= MAX_SESSIONS_ATTEMPTED_PER_RUN) break;
  }

  return json({ ok: true, ...summary });
}
