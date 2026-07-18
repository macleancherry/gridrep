import { getViewer } from "../../_lib/auth";
import { createRacePlan, CreateRacePlanError } from "../../_lib/plannerRacePlan";
import { json, jsonError } from "../../_lib/httpJson";

/** Create a race plan (PRD §7/§8): event + lineup + car/fuel-tank capacity. */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to create a race plan." });
  }

  const body = await context.request.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : null;
  const custIds: string[] = Array.isArray(body?.custIds) ? body.custIds.map(String).filter(Boolean) : [];

  if (!eventId) {
    return jsonError(400, { error: "invalid_event_id", message: "eventId is required." });
  }

  try {
    const plan = await createRacePlan(context.env.DB, {
      eventId,
      createdByUserId: viewer.user!.id,
      custIds,
      name: typeof body?.name === "string" ? body.name : undefined,
      carName: typeof body?.carName === "string" ? body.carName : null,
      fuelTankCapacityLiters: typeof body?.fuelTankCapacityLiters === "number" ? body.fuelTankCapacityLiters : null,
      pitStopSeconds: typeof body?.pitStopSeconds === "number" ? body.pitStopSeconds : null,
      raceDurationMinutes: typeof body?.raceDurationMinutes === "number" ? body.raceDurationMinutes : null,
    });
    return json({ ok: true, plan });
  } catch (err: any) {
    if (err instanceof CreateRacePlanError) {
      return jsonError(404, { error: err.code, message: err.message });
    }
    throw err;
  }
}
