import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator, isTeamMember, getWeekendTeamId } from "../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../_lib/httpJson";

/** The pool of team-roster drivers in scope for this race weekend, picked before splitting
 *  across cars (PRD phase 6). GET is member-visible (drivers need to see who else is in
 *  scope); PUT (replace wholesale) is coordinator-only. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const teamId = await getWeekendTeamId(DB, weekendId);
  if (!teamId || !(await isTeamMember(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this race weekend." });
  }

  const rosterRows = await DB.prepare(
    `SELECT m.cust_id as custId, d.display_name as driverName
     FROM team_members m LEFT JOIN drivers d ON d.iracing_member_id = m.cust_id
     WHERE m.team_id = ? ORDER BY d.display_name`
  )
    .bind(teamId)
    .all<any>();

  const participantRows = await DB.prepare(`SELECT cust_id as custId FROM race_weekend_participants WHERE race_weekend_id = ?`)
    .bind(weekendId)
    .all<any>();
  const participantIds = new Set((participantRows.results ?? []).map((r: any) => r.custId));

  return json({
    ok: true,
    roster: rosterRows.results ?? [],
    participantCustIds: [...participantIds],
  });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const teamId = await getWeekendTeamId(DB, weekendId);
  if (!teamId || !(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a team coordinator can set this race weekend's participants." });
  }

  const body = await context.request.json().catch(() => null);
  const custIds: string[] = Array.isArray(body?.custIds) ? [...new Set(body.custIds.map(String).filter(Boolean))] : [];

  await DB.batch([
    DB.prepare(`DELETE FROM race_weekend_participants WHERE race_weekend_id = ?`).bind(weekendId),
    ...custIds.map((custId) =>
      DB.prepare(`INSERT OR IGNORE INTO race_weekend_participants (race_weekend_id, cust_id) VALUES (?, ?)`).bind(weekendId, custId)
    ),
  ]);

  return json({ ok: true, participantCustIds: custIds });
}
