import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator, getWeekendTeamId } from "../../../../_lib/plannerTeams";
import { createRacePlan, CreateRacePlanError } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/** Adds another Car Entry to an existing race weekend (PRD phase 6: "select whether
 *  you'll be running a single or multiple cars... add drivers into the race weekend and
 *  then categorize drivers between each car"). This is how a weekend that started as the
 *  ordinary single-car flow becomes multi-car - coordinator-only, and only meaningful for
 *  a team weekend (a solo driver's own weekend has nowhere to reach this from). */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(`SELECT id, event_id as eventId FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }

  const teamId = await getWeekendTeamId(DB, weekendId);
  if (!teamId || !(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a team coordinator can add cars to this race weekend." });
  }

  const body = await context.request.json().catch(() => null);
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const carName = typeof body?.carName === "string" ? body.carName.trim() : null;

  try {
    const plan = await createRacePlan(DB, {
      eventId: weekend.eventId,
      createdByUserId: viewer.user!.id,
      raceWeekendId: weekendId,
      name,
      carName,
    });
    return json({ ok: true, car: plan });
  } catch (err: any) {
    if (err instanceof CreateRacePlanError) {
      return jsonError(400, { error: err.code, message: err.message });
    }
    throw err;
  }
}
