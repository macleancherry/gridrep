import { getViewer, getValidGarage61AccessToken } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { fetchGarage61TeamDetail } from "../../../../_lib/garage61";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Bulk roster import from a Garage 61 team the coordinator's own connected account
 * belongs to - the same team_members insert members.ts already does for a single driver,
 * just looped over whichever Garage 61 members the coordinator explicitly selected (via
 * the members.ts picker endpoint's list) and who have a linked iRacing account. Re-running
 * this later only adds members who weren't already on the roster (ON CONFLICT DO NOTHING)
 * - it never removes anyone, so it's safe to use again after the Garage 61 team's roster
 * changes.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id, name FROM teams WHERE id = ?`).bind(teamId).first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can import a roster into this team." });
  }

  const body = await context.request.json().catch(() => null);
  const g61TeamId = typeof body?.g61TeamId === "string" ? body.g61TeamId.trim() : "";
  if (!g61TeamId) {
    return jsonError(400, { error: "invalid_g61_team_id", message: "g61TeamId is required." });
  }

  // Explicit, coordinator-picked selection - never "everyone in the Garage 61 team" by
  // default (see functions/api/planner/garage61/teams/[g61TeamId]/members.ts, the picker
  // this list comes from).
  const selectedCustIds = Array.isArray(body?.custIds) ? new Set(body.custIds.map(String)) : null;
  if (!selectedCustIds) {
    return jsonError(400, { error: "invalid_cust_ids", message: "custIds (array of drivers to import) is required." });
  }

  const accessToken = await getValidGarage61AccessToken(context, viewer.user!.id).catch(() => null);
  if (!accessToken) {
    return jsonError(400, { error: "not_connected", message: "Connect Garage 61 first to import a team." });
  }

  let detail;
  try {
    detail = await fetchGarage61TeamDetail(accessToken, g61TeamId);
  } catch (err: any) {
    return jsonError(502, { error: "garage61_unreachable", message: "Could not load that Garage 61 team. Please try again." });
  }

  // Remember which Garage 61 team this roster came from - lets the fuel/pit-time
  // name-matching fallback (plannerGarage61Fuel.ts) scope its lap search to just this
  // team instead of every Garage 61 team the connecting coordinator happens to belong to.
  if (detail.slug) {
    await DB.prepare(`UPDATE teams SET garage61_team_slug = ? WHERE id = ?`).bind(detail.slug, teamId).run();
  }

  const now = new Date().toISOString();
  let imported = 0;
  let alreadyOnRoster = 0;
  let skippedNoIracingAccount = 0;

  for (const member of detail.members ?? []) {
    const iracingAccount = (member.accounts ?? []).find((a) => a.platform === "iracing");
    if (!iracingAccount?.id) {
      skippedNoIracingAccount++;
      continue;
    }
    const custId = iracingAccount.id;
    if (!selectedCustIds.has(custId)) continue; // not chosen by the coordinator - leave off the roster

    const displayName = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.slug;

    const existingMember = await DB.prepare(`SELECT 1 FROM team_members WHERE team_id = ? AND cust_id = ?`)
      .bind(teamId, custId)
      .first<any>();
    if (existingMember) {
      alreadyOnRoster++;
      continue;
    }

    if (displayName) {
      await DB.prepare(
        `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(iracing_member_id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`
      )
        .bind(custId, displayName, now)
        .run();
    }

    const existingUser = await DB.prepare(`SELECT id FROM users WHERE iracing_member_id = ?`).bind(custId).first<any>();

    await DB.prepare(
      `INSERT INTO team_members (team_id, cust_id, user_id, role, status, invited_at, joined_at)
       VALUES (?, ?, ?, 'driver', ?, ?, ?)
       ON CONFLICT(team_id, cust_id) DO NOTHING`
    )
      .bind(teamId, custId, existingUser?.id ?? null, existingUser ? "active" : "invited", now, existingUser ? now : null)
      .run();

    imported++;
  }

  return json({
    ok: true,
    teamName: detail.name,
    imported,
    alreadyOnRoster,
    skippedNoIracingAccount,
  });
}
