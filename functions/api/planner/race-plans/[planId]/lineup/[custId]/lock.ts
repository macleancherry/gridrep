import { getViewer } from "../../../../../../_lib/auth";
import { canManagePlan } from "../../../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../../../_lib/httpJson";

/**
 * Locks (PUT) or unlocks (DELETE) one driver's pace/fuel for this one race plan only -
 * the padlock next to their numbers on LineupPage.tsx. Locking freezes whatever pace/fuel
 * is passed in (typically the driver's currently-showing value, computed or default) and
 * stops any further auto-resync for them in this plan (driver-profiles.ts's GET/POST both
 * check race_plan_lineup.locked_at before touching driver_track_profiles for a driver).
 * Deliberately NOT written to the shared driver_track_profiles cache - a lock here never
 * affects a different race reusing the same driver+track+car, per the coordinator's own
 * choice of what "stop syncing for that race" means.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to lock this driver's data." });
  }

  const planId = context.params.planId as string;
  const custId = context.params.custId as string;
  const { DB } = context.env;

  const lineupRow = await DB.prepare(`SELECT 1 FROM race_plan_lineup WHERE race_plan_id = ? AND cust_id = ?`).bind(planId, custId).first<any>();
  if (!lineupRow) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this plan's lineup." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await canManagePlan(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "Only this race's coordinator can lock a driver's data." });
  }

  const body = await context.request.json().catch(() => null);
  const paceMs = typeof body?.paceMs === "number" && body.paceMs > 0 ? body.paceMs : null;
  const fuelPerLap = typeof body?.fuelPerLap === "number" && body.fuelPerLap > 0 ? body.fuelPerLap : null;
  if (paceMs === null && fuelPerLap === null) {
    return jsonError(400, { error: "invalid_values", message: "paceMs and/or fuelPerLap is required to lock." });
  }

  const now = new Date().toISOString();
  await DB.prepare(
    `UPDATE race_plan_lineup SET locked_pace_ms = ?, locked_fuel_per_lap = ?, locked_at = ? WHERE race_plan_id = ? AND cust_id = ?`
  )
    .bind(paceMs, fuelPerLap, now, planId, custId)
    .run();

  return json({ ok: true, custId, lockedPaceMs: paceMs, lockedFuelPerLap: fuelPerLap, lockedAt: now });
}

export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to unlock this driver's data." });
  }

  const planId = context.params.planId as string;
  const custId = context.params.custId as string;
  const { DB } = context.env;

  const lineupRow = await DB.prepare(`SELECT 1 FROM race_plan_lineup WHERE race_plan_id = ? AND cust_id = ?`).bind(planId, custId).first<any>();
  if (!lineupRow) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this plan's lineup." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await canManagePlan(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "Only this race's coordinator can unlock a driver's data." });
  }

  await DB.prepare(`UPDATE race_plan_lineup SET locked_pace_ms = NULL, locked_fuel_per_lap = NULL, locked_at = NULL WHERE race_plan_id = ? AND cust_id = ?`)
    .bind(planId, custId)
    .run();

  return json({ ok: true, custId });
}
