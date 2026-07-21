import { getViewer } from "../../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../../_lib/httpJson";

/** Removes one driver from a team's roster. Coordinator-only. The team's creator can't be
 *  removed this way - a team is never left without at least one coordinator able to manage
 *  it (same invariant teams.ts's POST establishes at creation time); deleting the whole
 *  team is the only way to get rid of that row. Doesn't touch any race plan this driver is
 *  already on - roster membership and a specific car's lineup are independent by design
 *  (see LineupPage's own "×" remove, which is the right place to pull someone off a car). */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const custId = context.params.custId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id, created_by as createdBy FROM teams WHERE id = ?`).bind(teamId).first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can remove drivers from this team." });
  }

  const member = await DB.prepare(`SELECT user_id as userId FROM team_members WHERE team_id = ? AND cust_id = ?`)
    .bind(teamId, custId)
    .first<any>();
  if (!member) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this team's roster." });
  }
  if (member.userId && member.userId === team.createdBy) {
    return jsonError(400, { error: "cannot_remove_creator", message: "The team's creator can't be removed from the roster — delete the team instead." });
  }

  await DB.prepare(`DELETE FROM team_members WHERE team_id = ? AND cust_id = ?`).bind(teamId, custId).run();

  return json({ ok: true });
}
