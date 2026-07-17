import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";
import { computeStintProjections, type StintInput } from "../../../../_lib/plannerRacePlan";

/**
 * Set/update the full stint assignment list (PRD §8) - replaces the plan's stints
 * wholesale (simplest correct model for a reorderable list) and recomputes fuel/lap/pit
 * projections server-side so the stored plan and any client's view of it always agree.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to edit stints." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const body = await context.request.json().catch(() => null);
  const rawStints = Array.isArray(body?.stints) ? body.stints : [];

  const stintInputs: StintInput[] = [];
  for (const s of rawStints) {
    const custId = typeof s?.custId === "string" ? s.custId : null;
    const lapCount = typeof s?.lapCount === "number" && s.lapCount > 0 ? Math.trunc(s.lapCount) : null;
    const paceMs = typeof s?.paceMs === "number" && s.paceMs > 0 ? s.paceMs : null;
    const fuelPerLap = typeof s?.fuelPerLap === "number" && s.fuelPerLap > 0 ? s.fuelPerLap : null;

    if (!custId || !lapCount || !paceMs || !fuelPerLap) {
      return jsonError(400, {
        error: "invalid_stint",
        message: "Each stint needs custId, lapCount, paceMs, and fuelPerLap (from a computed driver profile).",
      });
    }

    stintInputs.push({ custId, lapCount, paceMs, fuelPerLap });
  }

  const { stints, totals } = computeStintProjections(stintInputs, {
    pitStopSeconds: plan.pit_stop_seconds,
    tankCapacityLiters: plan.fuel_tank_capacity_liters,
  });

  await DB.prepare(`DELETE FROM race_plan_stints WHERE race_plan_id = ?`).bind(planId).run();

  const statements = stints.map((s) =>
    DB.prepare(
      `INSERT INTO race_plan_stints (
         id, race_plan_id, stint_order, cust_id, lap_count, pace_ms, fuel_per_lap,
         start_offset_minutes, duration_minutes, fuel_load_liters, pit_target_offset_minutes, fuel_warning
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      planId,
      s.order,
      s.custId,
      s.lapCount,
      s.paceMs,
      s.fuelPerLap,
      s.startOffsetMinutes,
      s.durationMinutes,
      s.fuelLoadLiters,
      s.pitTargetOffsetMinutes,
      s.fuelWarning ? 1 : 0
    )
  );
  if (statements.length > 0) await DB.batch(statements);

  await DB.prepare(`UPDATE race_plans SET updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), planId).run();

  const driverRows = await DB.prepare(
    `SELECT iracing_member_id as custId, display_name as driverName FROM drivers WHERE iracing_member_id IN (${stintInputs
      .map(() => "?")
      .join(",") || "''"})`
  )
    .bind(...stintInputs.map((s) => s.custId))
    .all<any>();
  const driverNameByCustId = new Map((driverRows.results ?? []).map((r: any) => [r.custId, r.driverName]));

  return json({
    ok: true,
    planId,
    stints: stints.map((s) => ({ ...s, driverName: driverNameByCustId.get(s.custId) ?? `Driver ${s.custId}` })),
    totals,
  });
}
