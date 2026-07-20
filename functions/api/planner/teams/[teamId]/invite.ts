import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * One active reusable invite link per team (PRD decision: shareable link, not a bot
 * integration). POST regenerates it - revokes whatever was active before rather than
 * deleting it, so an old link 404s with a clear "revoked" reason instead of vanishing
 * silently. Coordinator-only: the link is effectively an open door onto the roster.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's invite link." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id FROM teams WHERE id = ?`).bind(teamId).first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can manage this team's invite link." });
  }

  const now = new Date().toISOString();
  const newId = crypto.randomUUID();

  await DB.batch([
    DB.prepare(`UPDATE team_invites SET revoked_at = ? WHERE team_id = ? AND revoked_at IS NULL`).bind(now, teamId),
    DB.prepare(`INSERT INTO team_invites (id, team_id, created_by, created_at) VALUES (?, ?, ?, ?)`).bind(
      newId,
      teamId,
      viewer.user!.id,
      now
    ),
  ]);

  return json({ ok: true, teamId, inviteToken: newId });
}
