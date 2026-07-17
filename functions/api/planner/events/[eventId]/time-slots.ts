import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Scheduled start options for an event (PRD §13.1/§13.5). Most events - especially
 * special events, which usually publish one global green-flag time - never get a row
 * here; the UI should skip slot selection entirely when this list is empty and just use
 * the event's own scheduled_start_time as the race's UTC anchor.
 */
export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const rows = await DB.prepare(
    `SELECT id, event_id as eventId, label, start_datetime_utc as startDatetimeUtc, source
     FROM race_plan_time_slots WHERE event_id = ? ORDER BY start_datetime_utc ASC`
  )
    .bind(eventId)
    .all<any>();

  return json({ ok: true, eventId, slots: rows.results ?? [] });
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to add a time slot." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT id FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before adding a time slot." });
  }

  const body = await context.request.json().catch(() => null);
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null;
  const startDatetimeUtc = typeof body?.startDatetimeUtc === "string" ? body.startDatetimeUtc : null;

  if (!label || !startDatetimeUtc || Number.isNaN(Date.parse(startDatetimeUtc))) {
    return jsonError(400, { error: "invalid_slot", message: "label and a valid ISO startDatetimeUtc are required." });
  }

  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO race_plan_time_slots (id, event_id, label, start_datetime_utc, source) VALUES (?, ?, ?, ?, 'manual')`
  )
    .bind(id, eventId, label, startDatetimeUtc)
    .run();

  const slot = await DB.prepare(`SELECT * FROM race_plan_time_slots WHERE id = ?`).bind(id).first<any>();
  return json({ ok: true, slot });
}
