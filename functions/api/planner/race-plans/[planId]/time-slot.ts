import { getViewer } from "../../../../_lib/auth";
import { isPlanVisible } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/** Set the plan's chosen time slot (PRD §13.5) - null/omit to fall back to the event's own scheduled start. */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to set the time slot." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id, event_id as eventId FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const body = await context.request.json().catch(() => null);
  const timeSlotId = typeof body?.timeSlotId === "string" ? body.timeSlotId : null;

  if (timeSlotId) {
    const slot = await DB.prepare(`SELECT id FROM race_plan_time_slots WHERE id = ? AND event_id = ?`).bind(timeSlotId, plan.eventId).first<any>();
    if (!slot) {
      return jsonError(404, { error: "slot_not_found", message: "Time slot not found for this event." });
    }
  }

  await DB.prepare(`UPDATE race_plans SET time_slot_id = ?, updated_at = ? WHERE id = ?`)
    .bind(timeSlotId, new Date().toISOString(), planId)
    .run();

  return json({ ok: true, planId, timeSlotId });
}
