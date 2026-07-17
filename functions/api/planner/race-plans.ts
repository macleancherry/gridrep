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
  const event = await DB.prepare(`SELECT id, name, duration_minutes as durationMinutes FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before creating a plan." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : event.name;
  const carName = typeof body?.carName === "string" ? body.carName : null;
  const fuelTankCapacityLiters = typeof body?.fuelTankCapacityLiters === "number" ? body.fuelTankCapacityLiters : null;
  const raceDurationMinutes =
    typeof body?.raceDurationMinutes === "number" && body.raceDurationMinutes > 0 ? body.raceDurationMinutes : event.durationMinutes ?? null;

  // Inherit the event's shared pit rules (§15.2) as the plan's default pit-stop time
  // unless the caller explicitly overrides it - a plan-level override is still just a
  // normal field from here on, per the PRD's "shared record is the default source of
  // truth, override stays possible" model.
  let pitStopSeconds = typeof body?.pitStopSeconds === "number" && body.pitStopSeconds > 0 ? body.pitStopSeconds : null;
  if (pitStopSeconds === null) {
    const pitRules = await DB.prepare(
      `SELECT base_pit_time_seconds as basePitTimeSeconds, simultaneous_fuel_tyres as simultaneousFuelTyres,
              sequential_time_penalty_seconds as sequentialTimePenaltySeconds
       FROM event_pit_rules WHERE event_id = ?`
    )
      .bind(eventId)
      .first<any>();

    pitStopSeconds = pitRules
      ? pitRules.basePitTimeSeconds + (pitRules.simultaneousFuelTyres ? 0 : pitRules.sequentialTimePenaltySeconds)
      : 55;
  }

  await DB.prepare(
    `INSERT INTO race_plans (id, event_id, name, car_name, fuel_tank_capacity_liters, pit_stop_seconds, race_duration_minutes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, name, carName, fuelTankCapacityLiters, pitStopSeconds, raceDurationMinutes, viewer.user!.id, now, now)
    .run();

  for (const custId of custIds) {
    await DB.prepare(`INSERT OR IGNORE INTO race_plan_lineup (race_plan_id, cust_id) VALUES (?, ?)`).bind(id, custId).run();
  }

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(id).first<any>();
  return json({ ok: true, plan: { ...plan, custIds } });
}
