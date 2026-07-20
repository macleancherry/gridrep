import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

async function resolveInvite(DB: any, token: string) {
  return DB.prepare(
    `SELECT i.team_id as teamId, i.revoked_at as revokedAt, t.name as teamName
     FROM team_invites i JOIN teams t ON t.id = i.team_id
     WHERE i.id = ?`
  )
    .bind(token)
    .first<any>();
}

/** Resolves an invite token to its team, for the join landing page to show before the
 *  visitor commits. Requires a signed-in viewer (the page itself bounces a signed-out
 *  visitor through /api/auth/start?returnTo=... first, same pattern as every other gated
 *  planner page) so "already a member" can be answered accurately. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this invite." });
  }

  const token = context.params.token as string;
  const { DB } = context.env;

  const invite = await resolveInvite(DB, token);
  if (!invite) {
    return jsonError(404, { error: "not_found", message: "This invite link doesn't exist." });
  }
  if (invite.revokedAt) {
    return jsonError(410, { error: "revoked", message: "This invite link has been deactivated - ask your coordinator for a new one." });
  }

  const existing = await DB.prepare(`SELECT status FROM team_members WHERE team_id = ? AND cust_id = ?`)
    .bind(invite.teamId, viewer.user!.iracingId)
    .first<any>();

  return json({
    ok: true,
    team: { id: invite.teamId, name: invite.teamName },
    alreadyMember: existing?.status === "active",
  });
}

/** Accepts an invite: seats the viewer on the team as an active driver. If a coordinator
 *  had already pre-added this cust_id (status 'invited', no user_id yet), this just fills
 *  in the missing user_id and flips status - their role (in case a coordinator had already
 *  set one) is left alone rather than reset to the 'driver' default. */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to accept this invite." });
  }

  const token = context.params.token as string;
  const { DB } = context.env;

  const invite = await resolveInvite(DB, token);
  if (!invite) {
    return jsonError(404, { error: "not_found", message: "This invite link doesn't exist." });
  }
  if (invite.revokedAt) {
    return jsonError(410, { error: "revoked", message: "This invite link has been deactivated - ask your coordinator for a new one." });
  }

  const now = new Date().toISOString();
  const custId = viewer.user!.iracingId;

  await DB.prepare(
    `INSERT INTO team_members (team_id, cust_id, user_id, role, status, invited_at, joined_at)
     VALUES (?, ?, ?, 'driver', 'active', ?, ?)
     ON CONFLICT(team_id, cust_id) DO UPDATE SET
       user_id = excluded.user_id, status = 'active', joined_at = COALESCE(team_members.joined_at, excluded.joined_at)`
  )
    .bind(invite.teamId, custId, viewer.user!.id, now, now)
    .run();

  return json({ ok: true, team: { id: invite.teamId, name: invite.teamName } });
}
