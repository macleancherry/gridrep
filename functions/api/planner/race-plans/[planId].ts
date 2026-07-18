import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";
import { computeStintProjections, computeDutyWarnings, isPlanVisible, type StintInput, type SpottingAssignment } from "../../../_lib/plannerRacePlan";

/** Retrieve a plan for display/export (PRD §8) - stints + live-recomputed totals.
 * Only visible to the plan's creator or a driver in its lineup (never another team's
 * plan for the same shared event, just by knowing its id). */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to view this plan." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const lineupRows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName
     FROM race_plan_lineup l LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();

  const stintRows = await DB.prepare(
    `SELECT s.id, s.stint_order as stintOrder, s.cust_id as custId, d.display_name as driverName,
            s.lap_count as lapCount, s.pace_ms as paceMs, s.fuel_per_lap as fuelPerLap
     FROM race_plan_stints s LEFT JOIN drivers d ON d.iracing_member_id = s.cust_id
     WHERE s.race_plan_id = ? ORDER BY s.stint_order ASC`
  )
    .bind(planId)
    .all<any>();

  const stintInputs: StintInput[] = (stintRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    lapCount: r.lapCount,
    paceMs: r.paceMs,
    fuelPerLap: r.fuelPerLap,
  }));

  const { stints, totals } = computeStintProjections(stintInputs, {
    pitStopSeconds: plan.pit_stop_seconds,
    tankCapacityLiters: plan.fuel_tank_capacity_liters,
  });

  const driverNameByCustId = new Map((stintRows.results ?? []).map((r: any) => [r.custId, r.driverName]));

  const spottingRows = await DB.prepare(
    `SELECT a.cust_id as custId, d.display_name as driverName, a.start_time_offset_minutes as startOffsetMinutes,
            a.end_time_offset_minutes as endOffsetMinutes
     FROM race_plan_duty_assignments a LEFT JOIN drivers d ON d.iracing_member_id = a.cust_id
     WHERE a.race_plan_id = ? AND a.role = 'spotting' ORDER BY a.start_time_offset_minutes ASC`
  )
    .bind(planId)
    .all<any>();

  const spottingAssignments: SpottingAssignment[] = (spottingRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    startOffsetMinutes: r.startOffsetMinutes,
    endOffsetMinutes: r.endOffsetMinutes,
  }));

  const warnings = computeDutyWarnings(stints, spottingAssignments, plan.fatigue_threshold_minutes ?? 120);

  return json({
    ok: true,
    plan,
    eventId: plan.event_id, // plan itself is a raw `SELECT *` row (snake_case) - this is the camelCase convenience field
    lineup: lineupRows.results ?? [],
    stints: stints.map((s) => ({ ...s, driverName: driverNameByCustId.get(s.custId) ?? `Driver ${s.custId}` })),
    totals,
    spotting: spottingRows.results ?? [],
    warnings,
  });
}
