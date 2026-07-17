import { getViewer } from "../../_lib/auth";
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

  const { DB } = context.env;
  const event = await DB.prepare(`SELECT id, name FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before creating a plan." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : event.name;
  const carName = typeof body?.carName === "string" ? body.carName : null;
  const fuelTankCapacityLiters = typeof body?.fuelTankCapacityLiters === "number" ? body.fuelTankCapacityLiters : null;
  const pitStopSeconds = typeof body?.pitStopSeconds === "number" && body.pitStopSeconds > 0 ? body.pitStopSeconds : 55;

  await DB.prepare(
    `INSERT INTO race_plans (id, event_id, name, car_name, fuel_tank_capacity_liters, pit_stop_seconds, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, name, carName, fuelTankCapacityLiters, pitStopSeconds, viewer.user!.id, now, now)
    .run();

  for (const custId of custIds) {
    await DB.prepare(`INSERT OR IGNORE INTO race_plan_lineup (race_plan_id, cust_id) VALUES (?, ?)`).bind(id, custId).run();
  }

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(id).first<any>();
  return json({ ok: true, plan: { ...plan, custIds } });
}
