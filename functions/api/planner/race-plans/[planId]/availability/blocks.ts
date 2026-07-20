import { getViewer } from "../../../../../_lib/auth";
import { json, jsonError } from "../../../../../_lib/httpJson";
import { buildAvailabilityBlocks, ORGANIZER_OVERVIEW_ZONES, type ConditionWindow } from "../../../../../_lib/plannerAvailability";
import { isPlanVisibleToTeam } from "../../../../../_lib/plannerRacePlan";

/**
 * Block-by-block breakdown of the race (PRD §13.5) - used to render both the driver
 * submission grid (in the caller's own local time) and, alongside the fixed five-zone
 * list, the organizer's sanity-check overview (PRD §13.3).
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this plan's availability." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisibleToTeam(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const plan = await DB.prepare(
    `SELECT p.id, p.event_id as eventId, p.time_slot_id as timeSlotId, p.availability_block_minutes as blockMinutes,
            p.race_duration_minutes as raceDurationMinutes, e.scheduled_start_time as eventStartUtc, e.duration_minutes as eventDurationMinutes
     FROM race_plans p JOIN iracing_events e ON e.id = p.event_id
     WHERE p.id = ?`
  )
    .bind(planId)
    .first<any>();

  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  let startUtcIso = plan.eventStartUtc;
  if (plan.timeSlotId) {
    const slot = await DB.prepare(`SELECT start_datetime_utc as startDatetimeUtc FROM race_plan_time_slots WHERE id = ?`)
      .bind(plan.timeSlotId)
      .first<any>();
    if (slot) startUtcIso = slot.startDatetimeUtc;
  }

  if (!startUtcIso) {
    return jsonError(400, { error: "no_start_time", message: "This event has no scheduled start time set yet." });
  }

  const durationMinutes = plan.raceDurationMinutes ?? plan.eventDurationMinutes ?? 1440;

  let timeZone = url.searchParams.get("tz") ?? "UTC";
  if (!url.searchParams.get("tz")) {
    const userRow = await DB.prepare(`SELECT timezone FROM users WHERE id = ?`).bind(viewer.user!.id).first<any>();
    if (userRow?.timezone) timeZone = userRow.timezone;
  }

  const conditionRows = await DB.prepare(
    `SELECT label, window_offset_start_minutes as windowStartMin, window_offset_end_minutes as windowEndMin,
            expected_track_temp_min as trackTempMin, expected_track_temp_max as trackTempMax,
            expected_air_temp_min as airTempMin, expected_air_temp_max as airTempMax, expected_track_state as trackState
     FROM event_condition_profiles WHERE event_id = ?`
  )
    .bind(plan.eventId)
    .all<any>();

  const blocks = buildAvailabilityBlocks({
    startUtcIso,
    durationMinutes,
    blockMinutes: plan.blockMinutes,
    timeZone,
    conditionProfiles: (conditionRows.results ?? []) as ConditionWindow[],
  });

  const startMs = Date.parse(startUtcIso);
  const finishMs = startMs + durationMinutes * 60_000;
  const organizerZones = ORGANIZER_OVERVIEW_ZONES.map((zone) => ({
    zone,
    start: new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(startMs)),
    finish: new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(finishMs)),
  }));

  return json({ ok: true, planId, timeZone, startUtcIso, durationMinutes, blockMinutes: plan.blockMinutes, blocks, organizerZones });
}
