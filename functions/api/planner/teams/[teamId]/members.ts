import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { custIdForDriverId, displayDriver } from "../../../../_lib/driverIdentity";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Add a driver straight to the roster (PRD: "search for a driver" repointed at
 * team-roster-add). Reuses the same global iRacing driver search the Lineup page already
 * uses (functions/api/planner/drivers/search.ts) - this is just where its result now
 * gets written. If the picked driver already has a real gridrep account (they've signed
 * in before, just never touched this team), seat them as 'active' immediately instead of
 * making them click an invite link they don't need.
 *
 * Takes driverId, not a raw custid - the search endpoint already resolved/seeded a
 * driver_identities row for whatever was picked (real name included, storage only, not
 * display - see driverIdentity.ts), so the real custid is recovered here server-side
 * only, never supplied by (or returned to) the client.
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
  const driverId = typeof body?.driverId === "string" ? body.driverId.trim() : "";
  if (!driverId) {
    return jsonError(400, { error: "invalid_driver_id", message: "driverId is required." });
  }

  const custId = await custIdForDriverId(DB, driverId);
  if (!custId) {
    return jsonError(404, { error: "driver_not_found", message: "That driver wasn't found - try searching again." });
  }

  const now = new Date().toISOString();
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
    `SELECT m.role, m.status, m.invited_at as invitedAt, m.joined_at as joinedAt
     FROM team_members m WHERE m.team_id = ? AND m.cust_id = ?`
  )
    .bind(teamId, custId)
    .first<any>();

  const display = await displayDriver(DB, driverId);

  return json({ ok: true, member: { ...row, driverId, driverName: display.name } });
}
