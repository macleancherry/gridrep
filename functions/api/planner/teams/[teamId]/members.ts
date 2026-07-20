import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Add a driver straight to the roster (PRD: "search for a driver" repointed at
 * team-roster-add). Reuses the same global iRacing driver search the Lineup page already
 * uses (functions/api/planner/drivers/search.ts + the local drivers table) - this is just
 * where its result now gets written. If the picked cust_id already has a real gridrep
 * account (they've signed in before, just never touched this team), seat them as 'active'
 * immediately instead of making them click an invite link they don't need.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id FROM teams WHERE id = ?`).bind(teamId).first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can add drivers to this team." });
  }

  const body = await context.request.json().catch(() => null);
  const custId = typeof body?.custId === "string" ? body.custId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!custId) {
    return jsonError(400, { error: "invalid_cust_id", message: "custId is required." });
  }

  const now = new Date().toISOString();

  if (name) {
    await DB.prepare(
      `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(iracing_member_id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`
    )
      .bind(custId, name, now)
      .run();
  }

  const existingUser = await DB.prepare(`SELECT id FROM users WHERE iracing_member_id = ?`).bind(custId).first<any>();

  await DB.prepare(
    `INSERT INTO team_members (team_id, cust_id, user_id, role, status, invited_at, joined_at)
     VALUES (?, ?, ?, 'driver', ?, ?, ?)
     ON CONFLICT(team_id, cust_id) DO NOTHING`
  )
    .bind(
      teamId,
      custId,
      existingUser?.id ?? null,
      existingUser ? "active" : "invited",
      now,
      existingUser ? now : null
    )
    .run();

  const row = await DB.prepare(
    `SELECT m.cust_id as custId, d.display_name as driverName, m.role, m.status,
            m.invited_at as invitedAt, m.joined_at as joinedAt
     FROM team_members m LEFT JOIN drivers d ON d.iracing_member_id = m.cust_id
     WHERE m.team_id = ? AND m.cust_id = ?`
  )
    .bind(teamId, custId)
    .first<any>();

  return json({ ok: true, member: row });
}
