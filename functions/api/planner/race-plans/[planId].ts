import { json, jsonError } from "../../../_lib/httpJson";
import { computeStintProjections, type StintInput } from "../../../_lib/plannerRacePlan";

/** Retrieve a plan for display/export (PRD §8) - stints + live-recomputed totals. */
export async function onRequestGet(context: any) {
  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
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

  return json({
    ok: true,
    plan,
    lineup: lineupRows.results ?? [],
    stints: stints.map((s) => ({ ...s, driverName: driverNameByCustId.get(s.custId) ?? `Driver ${s.custId}` })),
    totals,
  });
}
