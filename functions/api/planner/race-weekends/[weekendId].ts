import { getViewer } from "../../../_lib/auth";
import { isTeamMember } from "../../../_lib/plannerTeams";
import { json, jsonError } from "../../../_lib/httpJson";

/** Race Weekend detail: its Car Entries and team. Only visible to the owning team's
 *  members - a weekend with no team (team_id NULL, a solo driver's own weekend) has no
 *  multi-car UI reachable at all, so this route is only ever hit for team weekends. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(
    `SELECT w.id, w.name, w.team_id as teamId, w.event_id as eventId, e.track_name as trackName
     FROM race_weekends w JOIN iracing_events e ON e.id = w.event_id WHERE w.id = ?`
  )
    .bind(weekendId)
    .first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }
  if (!weekend.teamId || !(await isTeamMember(DB, weekend.teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this race weekend." });
  }

  const carsRows = await DB.prepare(`SELECT id as carId, name, car_name as carName FROM race_plans WHERE race_weekend_id = ? ORDER BY created_at`)
    .bind(weekendId)
    .all<any>();

  return json({ ok: true, weekend, cars: carsRows.results ?? [] });
}
