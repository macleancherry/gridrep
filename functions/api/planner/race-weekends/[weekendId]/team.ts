import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Attaches (or re-attaches) an already-created race weekend to a team, after the fact.
 * Exists because the only place a weekend's team gets set today is at session-select time
 * (SeriesSessionsPage's team picker) - a coordinator who skipped that step, or picked the
 * wrong team, previously had no way to fix it short of starting a brand new plan from
 * scratch. Lineup's "roster isn't linked yet" prompt (LineupPage.tsx) calls this.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(`SELECT id, created_by as createdBy FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }
  if (weekend.createdBy !== viewer.user!.id) {
    return jsonError(403, { error: "forbidden", message: "Only the person who created this race weekend can link it to a team." });
  }

  const body = await context.request.json().catch(() => null);
  const teamId = typeof body?.teamId === "string" ? body.teamId.trim() : "";
  if (!teamId) {
    return jsonError(400, { error: "invalid_team_id", message: "teamId is required." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only that team's coordinator can link a race weekend to it." });
  }

  await DB.prepare(`UPDATE race_weekends SET team_id = ? WHERE id = ?`).bind(teamId, weekendId).run();

  return json({ ok: true, weekendId, teamId });
}
