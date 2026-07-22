import { getViewer } from "../../../_lib/auth";
import { isTeamMember, isTeamCoordinator } from "../../../_lib/plannerTeams";
import { cascadeDeleteRaceWeekend } from "../../../_lib/plannerRacePlan";
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
    `SELECT m.cust_id as custId, m.user_id as userId, d.display_name as driverName, m.role, m.status,
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

  // Upcoming race weekends (the missing link that made this page a dead end once a
  // coordinator actually planned a race - there was no way back into it except
  // re-searching the same series/session). One representative plan per weekend is enough
  // to link into Availability (weekend-scoped data, any of its cars' pages resolves it);
  // multi-car weekends also carry carCount so the UI can link management to the weekend
  // page instead of a single car.
  // LEFT JOIN, not JOIN: a brand-new weekend (created blank, before any of its cars has
  // picked a race yet) has no event at all - it must still show up in this list so the
  // coordinator can get back into it and start adding cars/races.
  const weekendRows = await DB.prepare(
    `SELECT rw.id as weekendId, rw.name as weekendName, rw.event_id as eventId,
            e.name as eventName, e.series_name as seriesName, e.track_name as trackName, e.scheduled_start_time as scheduledStartTime,
            (SELECT p.id FROM race_plans p WHERE p.race_weekend_id = rw.id ORDER BY p.created_at ASC LIMIT 1) as planId,
            (SELECT COUNT(*) FROM race_plans p WHERE p.race_weekend_id = rw.id) as carCount
     FROM race_weekends rw
     LEFT JOIN iracing_events e ON e.id = rw.event_id
     WHERE rw.team_id = ?
     ORDER BY e.scheduled_start_time DESC`
  )
    .bind(teamId)
    .all<any>();

  // Availability is now scoped per Car Entry, not the weekend - "has the viewer submitted
  // anything for this weekend" is checked against its representative planId (the same one
  // this response already links into), matching how a single-car weekend's availability
  // has always worked.
  const representativePlanIds = (weekendRows.results ?? []).map((r: any) => r.planId).filter(Boolean);
  let submittedPlanIds = new Set<string>();
  if (representativePlanIds.length > 0) {
    const placeholders = representativePlanIds.map(() => "?").join(",");
    const submittedRows = await DB.prepare(
      `SELECT DISTINCT race_plan_id as planId FROM driver_availability WHERE cust_id = ? AND race_plan_id IN (${placeholders})`
    )
      .bind(viewer.user!.iracingId, ...representativePlanIds)
      .all<any>();
    submittedPlanIds = new Set((submittedRows.results ?? []).map((r: any) => r.planId));
  }

  const weekends = (weekendRows.results ?? []).map((r: any) => ({
    weekendId: r.weekendId,
    name: r.weekendName ?? r.seriesName ?? r.eventName ?? "New race weekend",
    eventId: r.eventId,
    trackName: r.trackName,
    scheduledStartTime: r.scheduledStartTime,
    planId: r.planId,
    carCount: r.carCount,
    viewerHasSubmittedAvailability: r.planId ? submittedPlanIds.has(r.planId) : false,
  }));

  return json({
    ok: true,
    team,
    roster: rosterRows.results ?? [],
    isCoordinator: coordinator,
    inviteToken,
    weekends,
  });
}

/** Deletes a team outright: every race weekend it owns (and each weekend's Car Entries,
 *  same cascade as a single weekend delete), its invite link, its whole roster, then the
 *  team itself. Coordinator-only - matches every other team-wide write (invite, add/remove
 *  driver) rather than being creator-only, since a team can have more than one coordinator. */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to delete this team." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  const team = await DB.prepare(`SELECT id FROM teams WHERE id = ?`).bind(teamId).first<any>();
  if (!team) {
    return jsonError(404, { error: "not_found", message: "Team not found." });
  }
  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can delete this team." });
  }

  const weekendRows = await DB.prepare(`SELECT id FROM race_weekends WHERE team_id = ?`).bind(teamId).all<any>();
  for (const w of weekendRows.results ?? []) {
    await cascadeDeleteRaceWeekend(DB, w.id);
  }

  await DB.batch([
    DB.prepare(`DELETE FROM team_invites WHERE team_id = ?`).bind(teamId),
    DB.prepare(`DELETE FROM team_members WHERE team_id = ?`).bind(teamId),
    DB.prepare(`DELETE FROM teams WHERE id = ?`).bind(teamId),
  ]);

  return json({ ok: true });
}
