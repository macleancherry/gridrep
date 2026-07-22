import { getViewer } from "../../../_lib/auth";
import { canViewWeekend, canManageWeekend } from "../../../_lib/plannerTeams";
import { cascadeDeleteRaceWeekend } from "../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../_lib/httpJson";

/** Race Weekend detail: its Car Entries and team. Visible to the owning team's members,
 *  or - for a solo driver's own weekend (team_id NULL) - just its own creator. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(
    `SELECT w.id, w.name, w.team_id as teamId, w.event_id as eventId, e.track_name as trackName
     FROM race_weekends w LEFT JOIN iracing_events e ON e.id = w.event_id WHERE w.id = ?`
  )
    .bind(weekendId)
    .first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }
  if (!(await canViewWeekend(DB, weekendId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this race weekend." });
  }

  // Each car's own event, since a car can now pick a completely different race from the
  // others in this weekend - the checklist hub (RaceWeekendPage.tsx) needs to show each
  // car's own race/track status independently, not one weekend-wide value.
  const carsRows = await DB.prepare(
    `SELECT p.id as carId, p.name, p.car_name as carName, p.event_id as eventId,
            e.name as eventName, e.series_name as seriesName, e.track_name as trackName,
            e.scheduled_start_time as scheduledStartTime,
            (SELECT COUNT(*) FROM race_plan_lineup l WHERE l.race_plan_id = p.id) as driverCount
     FROM race_plans p LEFT JOIN iracing_events e ON e.id = p.event_id
     WHERE p.race_weekend_id = ? ORDER BY p.created_at`
  )
    .bind(weekendId)
    .all<any>();

  const coordinator = await canManageWeekend(DB, weekendId, viewer.user!.id);

  return json({ ok: true, weekend, cars: carsRows.results ?? [], isCoordinator: coordinator });
}

/** Deletes this Race Weekend and every Car Entry in it. Coordinator-only (or the solo
 *  creator, for a team-less weekend), same gating as the rest of this weekend's write
 *  endpoints (add car, set participants, distribution). */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to delete this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(`SELECT team_id as teamId FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }
  if (!(await canManageWeekend(DB, weekendId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only this weekend's coordinator can delete it." });
  }

  await cascadeDeleteRaceWeekend(DB, weekendId);

  return json({ ok: true, teamId: weekend.teamId });
}
