import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Set the plan's spotting assignments (PRD §14) - driving assignments aren't stored here,
 * they're derived live from race_plan_stints (a stint's own [start, pit-target) window
 * already is that driver's driving time), so this table/endpoint is spotting-only.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to edit spotter assignments." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const body = await context.request.json().catch(() => null);
  const rawAssignments = Array.isArray(body?.assignments) ? body.assignments : [];

  const assignments: Array<{ custId: string; startOffsetMinutes: number; endOffsetMinutes: number }> = [];
  for (const a of rawAssignments) {
    const custId = typeof a?.custId === "string" ? a.custId : null;
    const start = typeof a?.startOffsetMinutes === "number" ? a.startOffsetMinutes : null;
    const end = typeof a?.endOffsetMinutes === "number" ? a.endOffsetMinutes : null;
    if (!custId || start === null || end === null || end <= start) {
      return jsonError(400, { error: "invalid_assignment", message: "Each assignment needs custId, startOffsetMinutes, and endOffsetMinutes > start." });
    }
    assignments.push({ custId, startOffsetMinutes: start, endOffsetMinutes: end });
  }

  await DB.prepare(`DELETE FROM race_plan_duty_assignments WHERE race_plan_id = ? AND role = 'spotting'`).bind(planId).run();

  const statements = assignments.map((a) =>
    DB.prepare(
      `INSERT INTO race_plan_duty_assignments (id, race_plan_id, cust_id, role, start_time_offset_minutes, end_time_offset_minutes)
       VALUES (?, ?, ?, 'spotting', ?, ?)`
    ).bind(crypto.randomUUID(), planId, a.custId, a.startOffsetMinutes, a.endOffsetMinutes)
  );
  if (statements.length > 0) await DB.batch(statements);

  return json({ ok: true, planId, assignments });
}
