import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { searchHostedSessionsForLeague, extractSubsessionIds, describeIracingError } from "../../_lib/paceIracing";
import { ingestPaceSubsession, PaceIngestError } from "../../_lib/paceIngest";
import { json, jsonError } from "../../_lib/httpJson";
import { sleep } from "../../_lib/concurrency";

const MAX_SESSIONS_PER_RUN = 25;
const INGEST_DELAY_MS = 500;

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
    cappedAt: null as number | null,
    failures: [] as Array<{ leagueId: string; subsessionId?: string; message: string }>,
    emptySearchSamples: [] as Array<{ leagueId: string; sample: string }>,
  };

  let ingestedThisRun = 0;

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
    let leagueIngestedCount = 0;

    for (const subsessionId of subsessionIds) {
      if (ingestedThisRun >= MAX_SESSIONS_PER_RUN) {
        summary.cappedAt = MAX_SESSIONS_PER_RUN;
        break;
      }

      if (ingestedThisRun > 0) await sleep(INGEST_DELAY_MS);

      try {
        await ingestPaceSubsession(context, subsessionId, {
          leagueId: league.leagueId,
          viewerUserId: viewer.user!.id,
          accessToken,
        });
        summary.sessionsIngested += 1;
        leagueIngestedCount += 1;
        ingestedThisRun += 1;
      } catch (err: any) {
        const message = err instanceof PaceIngestError ? err.message : (err?.message ?? String(err));
        summary.failures.push({ leagueId: league.leagueId, subsessionId, message });
      }
    }

    // Only advance the marker past what actually succeeded this run, so a
    // capped/partial run picks up the remainder next time instead of skipping it.
    if (leagueIngestedCount > 0 || subsessionIds.length === 0) {
      await DB.prepare(`UPDATE pace_leagues SET last_synced_at = ? WHERE league_id = ?`)
        .bind(summary.cappedAt ? league.lastSyncedAt ?? runStartedAt : runStartedAt, league.leagueId)
        .run();
    }

    if (summary.cappedAt) break;
  }

  return json({ ok: true, ...summary });
}
