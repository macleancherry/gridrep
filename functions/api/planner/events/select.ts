import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * Upserts a discovered event (the shape GET /api/planner/events returns) into the
 * planner's iracing_events table, so it has a stable id that condition profiles,
 * race plans, etc. can attach to. Keyed on the event's own id (season-X / series-X),
 * per the PRD's "same event + scheduled start resolves to one record" rule (§7) -
 * calling this again for an event that's already stored just refreshes its fields.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to select an event." });
  }

  const body = await context.request.json().catch(() => null);
  const id = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (!id || !name) {
    return jsonError(400, { error: "invalid_event", message: "id and name are required." });
  }

  const eventType = body?.eventType === "special" || body?.eventType === "hosted" ? body.eventType : "league";
  const { DB } = context.env;
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO iracing_events (
       id, name, track_name, track_config, event_type, scheduled_start_time,
       duration_minutes, series_id, season_id, source, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'iracing_data_api', ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       track_name = COALESCE(excluded.track_name, iracing_events.track_name),
       track_config = COALESCE(excluded.track_config, iracing_events.track_config),
       event_type = excluded.event_type,
       scheduled_start_time = COALESCE(excluded.scheduled_start_time, iracing_events.scheduled_start_time),
       series_id = COALESCE(excluded.series_id, iracing_events.series_id),
       season_id = COALESCE(excluded.season_id, iracing_events.season_id)`
  )
    .bind(
      id,
      name,
      body?.trackName ?? null,
      body?.trackConfig ?? null,
      eventType,
      body?.scheduledStartTime ?? null,
      body?.durationMinutes ?? null,
      body?.seriesId ?? null,
      body?.seasonId ?? null,
      now
    )
    .run();

  const event = await DB.prepare(`SELECT * FROM iracing_events WHERE id = ?`).bind(id).first<any>();
  return json({ ok: true, event });
}
