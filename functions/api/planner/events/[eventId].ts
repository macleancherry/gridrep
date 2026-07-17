import { json, jsonError } from "../../../_lib/httpJson";

export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT * FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "not_found", message: "Event not found. Select it from the events list first." });
  }

  return json({ ok: true, event });
}
