import { getViewer } from "../../../_lib/auth";
import { isTeamMember, isTeamCoordinator } from "../../../_lib/plannerTeams";
import { json, jsonError } from "../../../_lib/httpJson";

/** Team detail + roster - only visible to the team's own members, never to an outsider
 *  just guessing a teamId. Roster includes invited-but-not-yet-joined rows too, since a
 *  coordinator needs to see who hasn't accepted yet. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this team." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id, name, created_by as createdBy, created_at as createdAt FROM teams WHERE id = ?`)
    .bind(teamId)
    .first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }

  if (!(await isTeamMember(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this team." });
  }

  const rosterRows = await DB.prepare(
    `SELECT m.cust_id as custId, d.display_name as driverName, m.role, m.status,
            m.invited_at as invitedAt, m.joined_at as joinedAt
     FROM team_members m LEFT JOIN drivers d ON d.iracing_member_id = m.cust_id
     WHERE m.team_id = ?
     ORDER BY m.role = 'coordinator' DESC, m.status = 'active' DESC, m.invited_at`
  )
    .bind(teamId)
    .all<any>();

  const coordinator = await isTeamCoordinator(DB, teamId, viewer.user!.id);
  let inviteToken: string | null = null;
  if (coordinator) {
    const invite = await DB.prepare(`SELECT id FROM team_invites WHERE team_id = ? AND revoked_at IS NULL LIMIT 1`)
      .bind(teamId)
      .first<any>();
    inviteToken = invite?.id ?? null;
  }

  return json({
    ok: true,
    team,
    roster: rosterRows.results ?? [],
    isCoordinator: coordinator,
    inviteToken,
  });
}
