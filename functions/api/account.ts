import { getViewer } from "../_lib/auth";
import { clearCookie } from "../_lib/cookies";
import { jsonError } from "../_lib/httpJson";

/**
 * Self-service full account deletion - operates only on the authenticated viewer's own
 * account (never an arbitrary target), so this adds no admin/other-user-targeting
 * capability to the API surface. Cascades through every table that references the user
 * (by users.id) or their driving identity (by cust_id/iracing_member_id), including
 * anything they own outright - teams, race weekends, race plans - even when other real
 * users are also part of them (decided: full clean wipe, matching "reset like a fresh
 * signup" rather than a hand-off/ownership-transfer model).
 *
 * Full table map (every migrations/*.sql file read to build this):
 *  - user-scoped: auth_sessions, oauth_tokens, garage61_oauth_tokens, user_preferences,
 *    driver_condition_preferences, driver_availability_template
 *  - cust_id-scoped: session_participants, props (both directions), pace_laps,
 *    planner_iracing_laps, driver_track_profiles, race_plan_lineup, race_plan_stints,
 *    driver_availability, race_plan_duty_assignments, driver_recent_session_search,
 *    team_members, race_weekend_participants
 *  - owned, cascaded: teams -> race_weekends -> race_plans (child-before-parent)
 *  - finally: users, drivers
 */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to delete your account." });
  }

  const { DB } = context.env;
  const userId = viewer.user!.id;
  const custId = viewer.user!.iracingId;

  // Collect every owned record's id, child-first, before issuing any deletes.
  const teamRows = await DB.prepare(`SELECT id FROM teams WHERE created_by = ?`).bind(userId).all<any>();
  const teamIds: string[] = (teamRows.results ?? []).map((r: any) => r.id);

  const weekendPlaceholders = teamIds.length ? teamIds.map(() => "?").join(",") : null;
  const weekendFromTeamsRows = weekendPlaceholders
    ? await DB.prepare(`SELECT id FROM race_weekends WHERE team_id IN (${weekendPlaceholders})`).bind(...teamIds).all<any>()
    : { results: [] };
  const weekendCreatedRows = await DB.prepare(`SELECT id FROM race_weekends WHERE created_by = ?`).bind(userId).all<any>();
  const weekendIds: string[] = [
    ...new Set([...(weekendFromTeamsRows.results ?? []).map((r: any) => r.id), ...(weekendCreatedRows.results ?? []).map((r: any) => r.id)]),
  ];

  const planPlaceholders = weekendIds.length ? weekendIds.map(() => "?").join(",") : null;
  const planFromWeekendsRows = planPlaceholders
    ? await DB.prepare(`SELECT id FROM race_plans WHERE race_weekend_id IN (${planPlaceholders})`).bind(...weekendIds).all<any>()
    : { results: [] };
  const planCreatedRows = await DB.prepare(`SELECT id FROM race_plans WHERE created_by = ?`).bind(userId).all<any>();
  const planIds: string[] = [
    ...new Set([...(planFromWeekendsRows.results ?? []).map((r: any) => r.id), ...(planCreatedRows.results ?? []).map((r: any) => r.id)]),
  ];

  const planPh = planIds.length ? planIds.map(() => "?").join(",") : null;
  const weekendPh = weekendIds.length ? weekendIds.map(() => "?").join(",") : null;
  const teamPh = teamIds.length ? teamIds.map(() => "?").join(",") : null;

  const statements: any[] = [];

  // Owned records, children first.
  if (planPh) {
    statements.push(DB.prepare(`DELETE FROM race_plan_lineup WHERE race_plan_id IN (${planPh})`).bind(...planIds));
    statements.push(DB.prepare(`DELETE FROM race_plan_stints WHERE race_plan_id IN (${planPh})`).bind(...planIds));
    statements.push(DB.prepare(`DELETE FROM race_plan_duty_assignments WHERE race_plan_id IN (${planPh})`).bind(...planIds));
  }
  if (weekendPh) {
    statements.push(DB.prepare(`DELETE FROM race_weekend_participants WHERE race_weekend_id IN (${weekendPh})`).bind(...weekendIds));
    statements.push(DB.prepare(`DELETE FROM driver_availability WHERE race_weekend_id IN (${weekendPh})`).bind(...weekendIds));
  }
  if (planPh) statements.push(DB.prepare(`DELETE FROM race_plans WHERE id IN (${planPh})`).bind(...planIds));
  if (weekendPh) statements.push(DB.prepare(`DELETE FROM race_weekends WHERE id IN (${weekendPh})`).bind(...weekendIds));
  if (teamPh) {
    statements.push(DB.prepare(`DELETE FROM team_invites WHERE team_id IN (${teamPh})`).bind(...teamIds));
    statements.push(DB.prepare(`DELETE FROM team_members WHERE team_id IN (${teamPh})`).bind(...teamIds));
    statements.push(DB.prepare(`DELETE FROM teams WHERE id IN (${teamPh})`).bind(...teamIds));
  }

  // Everywhere else this user appears, by cust_id or user_id.
  statements.push(
    DB.prepare(`DELETE FROM session_participants WHERE iracing_member_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM props WHERE to_iracing_member_id = ? OR from_user_id = ?`).bind(custId, userId),
    DB.prepare(`DELETE FROM pace_laps WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM planner_iracing_laps WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM driver_track_profiles WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM race_plan_lineup WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM race_plan_stints WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM race_plan_duty_assignments WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM driver_availability WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM driver_recent_session_search WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM team_members WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM race_weekend_participants WHERE cust_id = ?`).bind(custId),
    DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(userId),
    DB.prepare(`DELETE FROM oauth_tokens WHERE user_id = ?`).bind(userId),
    DB.prepare(`DELETE FROM garage61_oauth_tokens WHERE user_id = ?`).bind(userId),
    DB.prepare(`DELETE FROM user_preferences WHERE user_id = ?`).bind(userId),
    DB.prepare(`DELETE FROM driver_condition_preferences WHERE user_id = ?`).bind(userId),
    DB.prepare(`DELETE FROM driver_availability_template WHERE user_id = ?`).bind(userId)
  );

  // Finally the account itself and its public driver profile.
  statements.push(DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId), DB.prepare(`DELETE FROM drivers WHERE iracing_member_id = ?`).bind(custId));

  await DB.batch(statements);

  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearCookie("gr_session"));

  return new Response(
    JSON.stringify({
      ok: true,
      deleted: { teams: teamIds.length, raceWeekends: weekendIds.length, racePlans: planIds.length },
    }),
    { status: 200, headers }
  );
}
