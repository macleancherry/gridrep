import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";
import { computeStintProjections, isPlanVisible, type StintInput } from "../../../../_lib/plannerRacePlan";
import { computeLiveDeviation, type LiveRow } from "../../../../_lib/plannerLive";

/**
 * Live plan-vs-actual tracking (PRD §12, vision step 7). iRacing only assigns a real
 * subsession_id once a session has actually run, so the link between a plan and its live
 * telemetry is a manual paste-in (GET/PUT here), same as every other "confirm once live"
 * fallback in this schema. Once linked, GET proxies ignium-live-worker's already-public,
 * CORS-open /api/live?subsessionId= read (server-side, so the worker's URL isn't a
 * frontend concern and a transient fetch failure degrades gracefully instead of a 500).
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to view live tracking." });
  }

  const planId = context.params.planId as string;
  const { DB, LIVE_WORKER_URL } = context.env;

  const plan = await DB.prepare(
    `SELECT id, live_subsession_id as liveSubsessionId, pit_stop_seconds as pitStopSeconds, fuel_tank_capacity_liters as fuelTankCapacityLiters
     FROM race_plans WHERE id = ?`
  )
    .bind(planId)
    .first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  if (!plan.liveSubsessionId) {
    return json({ ok: true, linked: false });
  }

  const lineupRows = await DB.prepare(`SELECT cust_id as custId FROM race_plan_lineup WHERE race_plan_id = ?`).bind(planId).all<any>();
  const lineupCustIds: string[] = (lineupRows.results ?? []).map((r: any) => r.custId);

  const stintRows = await DB.prepare(
    `SELECT cust_id as custId, lap_count as lapCount, pace_ms as paceMs, fuel_per_lap as fuelPerLap
     FROM race_plan_stints WHERE race_plan_id = ? ORDER BY stint_order ASC`
  )
    .bind(planId)
    .all<any>();
  const stintInputs: StintInput[] = (stintRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    lapCount: r.lapCount,
    paceMs: r.paceMs,
    fuelPerLap: r.fuelPerLap,
  }));
  const { stints } = computeStintProjections(stintInputs, { pitStopSeconds: plan.pitStopSeconds, tankCapacityLiters: plan.fuelTankCapacityLiters });

  const workerBase = LIVE_WORKER_URL ?? "https://ignium-live-api.maclean-cherry.workers.dev";
  let rows: LiveRow[] = [];
  let fetchError: string | null = null;
  try {
    const r = await fetch(`${workerBase}/api/live?subsessionId=${encodeURIComponent(plan.liveSubsessionId)}`);
    const data = await r.json().catch(() => null);
    if (r.ok && data?.ok) {
      rows = data.rows ?? [];
    } else {
      fetchError = "The live timing service didn't return usable data.";
    }
  } catch {
    fetchError = "Could not reach the live timing service. It may be offline between sessions.";
  }

  const ourRows = rows.filter((r) => lineupCustIds.includes(String(r.customerId)));
  const deviation = fetchError ? null : computeLiveDeviation(stints, lineupCustIds, rows, plan.fuelTankCapacityLiters);

  return json({
    ok: true,
    linked: true,
    subsessionId: plan.liveSubsessionId,
    fetchError,
    fieldSize: rows.length,
    standings: rows.slice(0, 40),
    ourRows,
    deviation,
    generatedAt: new Date().toISOString(),
  });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to link live tracking." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const body = await context.request.json().catch(() => null);
  const raw = typeof body?.subsessionId === "string" ? body.subsessionId.trim() : "";
  const subsessionId = raw.length > 0 ? raw : null;

  await DB.prepare(`UPDATE race_plans SET live_subsession_id = ?, updated_at = ? WHERE id = ?`)
    .bind(subsessionId, new Date().toISOString(), planId)
    .run();

  return json({ ok: true, planId, subsessionId });
}
