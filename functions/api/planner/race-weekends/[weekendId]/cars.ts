import { getViewer } from "../../../../_lib/auth";
import { canManageWeekend } from "../../../../_lib/plannerTeams";
import { createRacePlan, CreateRacePlanError } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/** Adds another Car Entry to an existing race weekend (coordinator navigation rebuild,
 *  2026-07-22: "create a car or manage a car... then select the race for each car" - a
 *  car's own race is picked independently afterward, via select-session.ts's planId-attach
 *  mode, not forced to match another car in the same weekend). Coordinator-only, and only
 *  meaningful for a team weekend (a solo driver's own weekend has nowhere to reach this
 *  from). Deliberately does NOT pass the weekend's own event_id through to createRacePlan -
 *  a new car starts with no race selected at all, exactly like a brand-new weekend's first
 *  car; the weekend's own event_id (now vestigial - kept only as a display convenience for
 *  a still-single-race-per-weekend weekend) is never authoritative for its cars. */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const weekend = await DB.prepare(`SELECT id FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!weekend) {
    return jsonError(404, { error: "not_found", message: "Race weekend not found." });
  }

  if (!(await canManageWeekend(DB, weekendId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only this weekend's coordinator can add cars to it." });
  }

  const body = await context.request.json().catch(() => null);
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const carName = typeof body?.carName === "string" ? body.carName.trim() : null;

  try {
    const plan = await createRacePlan(DB, {
      eventId: null,
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
