import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Shared pit-stop rules for an event (PRD §15.2) - captured once, reused by every team
 * planning the same event, same pattern as event_condition_profiles. Presets are just
 * pre-filled defaults the caller can send as a normal save; nothing here hardcodes a
 * real-world series' rules as fact (the PRD is explicit that a specific special event
 * may simplify or diverge from what it's modeled on).
 */
export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const rules = await DB.prepare(
    `SELECT event_id as eventId, tyre_change_interval_stints as tyreChangeIntervalStints,
            simultaneous_fuel_tyres as simultaneousFuelTyres, base_pit_time_seconds as basePitTimeSeconds,
            sequential_time_penalty_seconds as sequentialTimePenaltySeconds, source, submitted_by as submittedBy,
            submitted_at as submittedAt, flagged_as_outdated as flaggedAsOutdated
     FROM event_pit_rules WHERE event_id = ?`
  )
    .bind(eventId)
    .first<any>();

  if (!rules) {
    return json({ ok: true, eventId, rules: null });
  }

  return json({ ok: true, eventId, rules: { ...rules, simultaneousFuelTyres: Boolean(rules.simultaneousFuelTyres), flaggedAsOutdated: Boolean(rules.flaggedAsOutdated) } });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to set pit rules." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT id FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before setting pit rules." });
  }

  const body = await context.request.json().catch(() => null);
  const source = ["preset", "manual", "derived"].includes(body?.source) ? body.source : "manual";
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO event_pit_rules (
       event_id, tyre_change_interval_stints, simultaneous_fuel_tyres, base_pit_time_seconds,
       sequential_time_penalty_seconds, source, submitted_by, submitted_at, flagged_as_outdated
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(event_id) DO UPDATE SET
       tyre_change_interval_stints = excluded.tyre_change_interval_stints,
       simultaneous_fuel_tyres = excluded.simultaneous_fuel_tyres,
       base_pit_time_seconds = excluded.base_pit_time_seconds,
       sequential_time_penalty_seconds = excluded.sequential_time_penalty_seconds,
       source = excluded.source,
       submitted_by = excluded.submitted_by,
       submitted_at = excluded.submitted_at,
       flagged_as_outdated = 0`
  )
    .bind(
      eventId,
      typeof body?.tyreChangeIntervalStints === "number" ? body.tyreChangeIntervalStints : null,
      body?.simultaneousFuelTyres === false ? 0 : 1,
      typeof body?.basePitTimeSeconds === "number" && body.basePitTimeSeconds > 0 ? body.basePitTimeSeconds : 55,
      typeof body?.sequentialTimePenaltySeconds === "number" ? body.sequentialTimePenaltySeconds : 0,
      source,
      viewer.user!.id,
      now
    )
    .run();

  const rules = await DB.prepare(`SELECT * FROM event_pit_rules WHERE event_id = ?`).bind(eventId).first<any>();
  return json({ ok: true, rules });
}
