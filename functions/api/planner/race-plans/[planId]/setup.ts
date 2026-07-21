import { getViewer } from "../../../../_lib/auth";
import { canManagePlan } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Sets this Car Entry's actual car and/or the coordinator's race-wide default pace/fuel.
 * Picking a car gates driver_track_profiles' car-scoped lookups (plannerDriverProfile.ts,
 * plannerGarage61Fuel.ts) - until it's set, pace/fuel stay scoped by track alone, exactly
 * as before this feature existed. The defaults are a fallback used for any driver who
 * doesn't have their own pace/fuel yet (new driver, no synced laps in this car), never
 * silently presented as that driver's own real data (driver-profiles.ts tags the source).
 * Coordinator-only, same write-access rule as every other plan-setup change.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to set up this race." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await canManagePlan(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "Only this race's coordinator can change its setup." });
  }

  const body = await context.request.json().catch(() => null);

  const carId = typeof body?.carId === "number" ? body.carId : body?.carId === null ? null : undefined;
  const carName = typeof body?.carName === "string" ? body.carName.trim() || null : body?.carName === null ? null : undefined;
  const carClassId = typeof body?.carClassId === "number" ? body.carClassId : body?.carClassId === null ? null : undefined;
  const defaultPaceMs = typeof body?.defaultPaceMs === "number" && body.defaultPaceMs > 0 ? body.defaultPaceMs : body?.defaultPaceMs === null ? null : undefined;
  const defaultFuelPerLap =
    typeof body?.defaultFuelPerLap === "number" && body.defaultFuelPerLap > 0 ? body.defaultFuelPerLap : body?.defaultFuelPerLap === null ? null : undefined;

  const sets: string[] = [];
  const values: any[] = [];
  if (carId !== undefined) {
    sets.push("car_id = ?");
    values.push(carId);
  }
  if (carName !== undefined) {
    sets.push("car_name = ?");
    values.push(carName);
  }
  if (carClassId !== undefined) {
    sets.push("car_class_id = ?");
    values.push(carClassId);
  }
  if (defaultPaceMs !== undefined) {
    sets.push("default_pace_ms = ?");
    values.push(defaultPaceMs);
  }
  if (defaultFuelPerLap !== undefined) {
    sets.push("default_fuel_per_lap = ?");
    values.push(defaultFuelPerLap);
  }

  if (sets.length === 0) {
    return jsonError(400, { error: "no_fields", message: "Nothing to update." });
  }

  values.push(planId);
  await DB.prepare(`UPDATE race_plans SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await DB.prepare(
    `SELECT car_id as carId, car_name as carName, car_class_id as carClassId,
            default_pace_ms as defaultPaceMs, default_fuel_per_lap as defaultFuelPerLap
     FROM race_plans WHERE id = ?`
  )
    .bind(planId)
    .first<any>();

  return json({ ok: true, ...updated });
}
