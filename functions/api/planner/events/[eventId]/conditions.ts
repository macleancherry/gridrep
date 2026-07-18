import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/**
 * Shared condition profile(s) for an event instance (PRD §5.3/§9) - captured once,
 * reused by every team that plans the same event. Real events get theirs auto-populated
 * from the iRacing forecast API at session-select time (see plannerIracing.ts's
 * derivePreRacePhaseProfiles/deriveConditionProfilesFromForecast); manual entry here is
 * only the fallback for events without a forecast available.
 */
export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const rows = await DB.prepare(
    `SELECT id, event_id as eventId, label, window_offset_start_minutes as windowStartMin,
            window_offset_end_minutes as windowEndMin, expected_track_temp_min as trackTempMin,
            expected_track_temp_max as trackTempMax, expected_air_temp_min as airTempMin,
            expected_air_temp_max as airTempMax, expected_track_state as trackState,
            expected_precip_pct as precipPct, expected_wind as wind, source, submitted_by as submittedBy,
            submitted_at as submittedAt
     FROM event_condition_profiles WHERE event_id = ? ORDER BY window_offset_start_minutes ASC NULLS LAST`
  )
    .bind(eventId)
    .all<any>();

  return json({ ok: true, eventId, profiles: rows.results ?? [] });
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to save a condition profile." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT id FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before adding a condition profile." });
  }

  const body = await context.request.json().catch(() => null);
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null;
  if (!label) {
    return jsonError(400, { error: "invalid_label", message: "label is required (e.g. \"Day\", \"Night\")." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO event_condition_profiles (
       id, event_id, label, window_offset_start_minutes, window_offset_end_minutes,
       expected_track_temp_min, expected_track_temp_max, expected_air_temp_min, expected_air_temp_max,
       expected_track_state, expected_precip_pct, expected_wind, source, submitted_by, submitted_at,
       was_edited_before_save, flagged_as_outdated
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, 0, 0)`
  )
    .bind(
      id,
      eventId,
      label,
      pickNumber(body?.windowStartMin),
      pickNumber(body?.windowEndMin),
      pickNumber(body?.trackTempMin),
      pickNumber(body?.trackTempMax),
      pickNumber(body?.airTempMin),
      pickNumber(body?.airTempMax),
      typeof body?.trackState === "string" ? body.trackState : null,
      pickNumber(body?.precipPct),
      typeof body?.wind === "string" ? body.wind : null,
      viewer.user!.id,
      now
    )
    .run();

  const profile = await DB.prepare(`SELECT * FROM event_condition_profiles WHERE id = ?`).bind(id).first<any>();
  return json({ ok: true, profile });
}
