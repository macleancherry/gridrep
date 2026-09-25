import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * Public, read-only: lists this league's already-synced races, for a
 * branded league view (see src/pace/pages/PaceHome.tsx) to browse without
 * needing the visitor to know a subsession ID or sign in - syncing new
 * races still requires a verified admin (see /api/pace/sync), this just
 * reads what's already in D1. Only fully-ingested subsessions are listed
 * so a partially-synced race doesn't show broken results.
 */
export async function onRequestGet(context: any) {
  const leagueId = context.params.leagueId as string;
  const { DB } = context.env;

  const league = await DB.prepare(
    `SELECT league_id as leagueId, name, last_synced_at as lastSyncedAt FROM pace_leagues WHERE league_id = ?`
  )
    .bind(leagueId)
    .first<any>();

  if (!league) {
    return jsonError(404, { error: "not_found", message: "League not followed." });
  }

  const races = await DB.prepare(
    `SELECT subsession_id as subsessionId, track_name as trackName, series_name as seriesName, start_time as startTime
     FROM pace_subsessions
     WHERE league_id = ? AND laps_complete = 1
     ORDER BY start_time DESC
     LIMIT 100`
  )
    .bind(leagueId)
    .all<any>();

  return json({ ok: true, league, races: races.results ?? [] });
}

export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to unfollow a league." });
  }

  const leagueId = context.params.leagueId as string;
  const { DB } = context.env;

  // pace_subsessions.league_id has a foreign key onto this table with no
  // cascade, so deleting a league that already has synced races would
  // otherwise throw a constraint error (and, with no error handling on the
  // frontend's fetch, look like the button silently does nothing). Unfollow
  // should stop future syncs, not erase results already pulled in, so
  // detach them (NULL league_id - the same state a manually-entered
  // subsession is already in) before removing the league row itself.
  await DB.batch([
    DB.prepare(`UPDATE pace_subsessions SET league_id = NULL WHERE league_id = ?`).bind(leagueId),
    DB.prepare(`DELETE FROM pace_leagues WHERE league_id = ?`).bind(leagueId),
  ]);

  return json({ ok: true, leagueId });
}
