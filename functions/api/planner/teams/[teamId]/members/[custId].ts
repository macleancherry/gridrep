import { getViewer } from "../../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../../_lib/httpJson";

/** Promotes a roster member to coordinator, or demotes a coordinator back to driver.
 *  Coordinator-only (any existing coordinator can manage any other, including demoting
 *  themselves) - the team's creator is the one exception, always kept as coordinator so a
 *  team is never left without one able to manage it (same invariant the DELETE handler
 *  below already protects). isTeamCoordinator itself already treats any 'coordinator'-role
 *  row as a real coordinator (see plannerTeams.ts), so this needs no other schema change -
 *  a promoted co-coordinator gets full manage rights the instant this lands. */
export async function onRequestPut(context: any) {
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
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can change roles on this team." });
  }

  const body = await context.request.json().catch(() => null);
  const role = body?.role;
  if (role !== "coordinator" && role !== "driver") {
    return jsonError(400, { error: "invalid_role", message: "role must be 'coordinator' or 'driver'." });
  }

  const member = await DB.prepare(`SELECT user_id as userId FROM team_members WHERE team_id = ? AND cust_id = ?`)
    .bind(teamId, custId)
    .first<any>();
  if (!member) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this team's roster." });
  }
  if (role === "driver" && member.userId && member.userId === team.createdBy) {
    return jsonError(400, {
      error: "cannot_demote_creator",
      message: "The team's creator is always a coordinator — delete the team instead if you want to hand it off.",
    });
  }

  await DB.prepare(`UPDATE team_members SET role = ? WHERE team_id = ? AND cust_id = ?`).bind(role, teamId, custId).run();

  return json({ ok: true, custId, role });
}

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
