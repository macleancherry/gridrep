import { json } from "../../../../_lib/httpJson";

/** List race plans for an event, so the UI can resume an existing plan instead of always creating a new one. */
export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const rows = await DB.prepare(
    `SELECT id, event_id as eventId, name, car_name as carName, fuel_tank_capacity_liters as fuelTankCapacityLiters,
            pit_stop_seconds as pitStopSeconds, created_at as createdAt, updated_at as updatedAt
     FROM race_plans WHERE event_id = ? ORDER BY updated_at DESC`
  )
    .bind(eventId)
    .all<any>();

  return json({ ok: true, eventId, plans: rows.results ?? [] });
}
