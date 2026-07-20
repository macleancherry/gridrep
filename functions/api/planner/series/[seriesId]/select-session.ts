import { getViewer } from "../../../../_lib/auth";
import {
  upsertIracingEvent,
  fetchWeatherForecast,
  deriveConditionProfilesFromForecast,
  derivePreRacePhaseProfiles,
  raceStartOffsetMinutes,
} from "../../../../_lib/plannerIracing";
import { createRacePlan, listVisiblePlansForEvent, CreateRacePlanError } from "../../../../_lib/plannerRacePlan";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Step 3: selecting a specific session. Body is the exact ScheduleSession (+ series name)
 * shape GET .../sessions already returned, POSTed back - the client echoes back what it
 * was given, avoiding a second iRacing fetch just to re-locate the same schedule entry
 * server-side.
 *
 * Does three things in one call: upserts the real event (track/duration/exact start time,
 * fixing the gap where season-level selection had no track data at all), auto-populates
 * shared condition profiles from the real forecast when one's available, and either
 * creates a new race plan or returns the viewer's own existing ones to resume - never
 * someone else's plan for the same shared event.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to select a session." });
  }

  const seriesId = context.params.seriesId as string;
  const body = await context.request.json().catch(() => null);

  const seasonId = body?.seasonId ? String(body.seasonId) : null;
  const seriesName = typeof body?.seriesName === "string" && body.seriesName.trim() ? body.seriesName.trim() : null;
  if (!seasonId || !seriesName) {
    return jsonError(400, { error: "invalid_session", message: "seasonId and seriesName are required." });
  }

  // A special event can offer several alternative real-world start times sharing one
  // forecast (see plan report) - each is a genuinely independent event for scheduling
  // purposes (different Availability windows), so only branch the id when there's
  // actually more than one slot to disambiguate. Keeps the common single-slot case
  // (regular series, and every already-selected event) resolving to the same id it
  // always has.
  const slotCount = typeof body?.slotCount === "number" ? body.slotCount : 1;
  const slotIndex = typeof body?.slotIndex === "number" ? body.slotIndex : 0;
  const eventId = slotCount > 1 ? `season-${seasonId}-slot${slotIndex}` : `season-${seasonId}`;
  const { DB } = context.env;

  // Optional: this weekend is being planned for a team roster, not just the coordinator's
  // own solo plan - only that team's coordinator may attach a new plan to it.
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : null;
  if (teamId && !(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "not_coordinator", message: "Only that team's coordinator can plan a weekend for it." });
  }

  const lengths = {
    practiceLengthMinutes: typeof body?.practiceLengthMinutes === "number" ? body.practiceLengthMinutes : undefined,
    qualifyLengthMinutes: typeof body?.qualifyLengthMinutes === "number" ? body.qualifyLengthMinutes : undefined,
    warmupLengthMinutes: typeof body?.warmupLengthMinutes === "number" ? body.warmupLengthMinutes : undefined,
  };
  const raceStart = raceStartOffsetMinutes(lengths);

  // scheduledStartTime from the client is when PRACTICE opens (weekend/session start);
  // every existing consumer (Availability block generation, PlanSummary's clock,
  // driver-profile computation) assumes iracing_events.scheduled_start_time means RACE
  // start, so shift it forward by the practice+qualifying+warmup lead-in here rather
  // than touching any of those consumers.
  const slotStartTime = typeof body?.scheduledStartTime === "string" && body.scheduledStartTime ? body.scheduledStartTime : null;
  const raceStartTime = slotStartTime ? new Date(Date.parse(slotStartTime) + raceStart * 60_000).toISOString() : null;

  const event = await upsertIracingEvent(DB, {
    id: eventId,
    name: typeof body?.scheduleName === "string" && body.scheduleName.trim() ? body.scheduleName.trim() : seriesName,
    trackName: body?.trackName ?? null,
    trackConfig: body?.trackConfig ?? null,
    eventType: "special",
    scheduledStartTime: raceStartTime,
    durationMinutes: typeof body?.raceLengthMinutes === "number" ? body.raceLengthMinutes : null,
    seriesId,
    seasonId,
    seriesName,
    minTeamDrivers: typeof body?.minTeamDrivers === "number" ? body.minTeamDrivers : null,
    maxTeamDrivers: typeof body?.maxTeamDrivers === "number" ? body.maxTeamDrivers : null,
    minFuelFillPct: typeof body?.minFuelFillPct === "number" ? body.minFuelFillPct : null,
    maxFuelFillPct: typeof body?.maxFuelFillPct === "number" ? body.maxFuelFillPct : null,
    minTireSets: typeof body?.minTireSets === "number" ? body.minTireSets : null,
    maxTireSets: typeof body?.maxTireSets === "number" ? body.maxTireSets : null,
  });

  // Auto-populate shared conditions from the real forecast, but only the first time -
  // "captured once, reused by every team" (PRD §5.3) means we shouldn't overwrite
  // something a prior team may have already confirmed/edited.
  let conditionProfiles: any[] = [];
  const existingProfileCount = await DB.prepare(`SELECT COUNT(*) as n FROM event_condition_profiles WHERE event_id = ?`)
    .bind(eventId)
    .first<{ n: number }>();

  if ((existingProfileCount?.n ?? 0) === 0 && typeof body?.weatherUrl === "string" && body.weatherUrl) {
    try {
      const hours = await fetchWeatherForecast(body.weatherUrl);

      // Practice/Qualifying/Warmup: flat summaries straight off the weekend-relative
      // timeline, offsets rebased to race-start-relative (comes out negative).
      const preRaceProfiles = derivePreRacePhaseProfiles(hours, lengths);

      // Race: same Day/Dusk/Night/Dawn bucketing as before, unchanged - just fed only
      // the race's own hours (offset >= raceStart), remapped so offset 0 is race start
      // rather than weekend start. For an event with no practice/qualifying data
      // (raceStart === 0) this filter+remap is a no-op - today's exact behavior.
      const raceHours = hours
        .filter((h) => h.timeOffsetMinutes >= raceStart)
        .map((h) => ({ ...h, timeOffsetMinutes: h.timeOffsetMinutes - raceStart }));
      const raceProfiles = deriveConditionProfilesFromForecast(raceHours);

      const derived = [...preRaceProfiles, ...raceProfiles];
      const now = new Date().toISOString();

      // Raw hourly timeline for the visual forecast chart - every hour, rebased to
      // race-start-relative like the bucketed profiles above (so practice/qualifying
      // hours come out negative), not just the bucketed Day/Dusk/Night/Dawn summaries.
      for (const h of hours) {
        await DB.prepare(
          `INSERT INTO event_forecast_hours (
             id, event_id, time_offset_minutes, is_sun_up, air_temp_c, precip_chance_pct, cloud_cover_pct, wind_speed
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            eventId,
            h.timeOffsetMinutes - raceStart,
            h.isSunUp ? 1 : 0,
            h.airTempC ?? null,
            h.precipChancePct ?? null,
            h.cloudCoverPct ?? null,
            h.windSpeed ?? null
          )
          .run();
      }

      for (const p of derived) {
        const id = crypto.randomUUID();
        await DB.prepare(
          `INSERT INTO event_condition_profiles (
             id, event_id, label, window_offset_start_minutes, window_offset_end_minutes,
             expected_track_temp_min, expected_track_temp_max, expected_air_temp_min, expected_air_temp_max,
             expected_track_state, expected_precip_pct, expected_wind, source, submitted_by, submitted_at,
             was_edited_before_save, flagged_as_outdated
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, 'iracing_data_api', ?, ?, 0, 0)`
        )
          .bind(
            id,
            eventId,
            p.label,
            p.windowStartMin,
            p.windowEndMin,
            p.airTempMin ?? null,
            p.airTempMax ?? null,
            p.trackState ?? null,
            p.precipPct ?? null,
            viewer.user!.id,
            now
          )
          .run();
      }

      const rows = await DB.prepare(`SELECT * FROM event_condition_profiles WHERE event_id = ? ORDER BY window_offset_start_minutes ASC`)
        .bind(eventId)
        .all<any>();
      conditionProfiles = rows.results ?? [];
    } catch (err: any) {
      // Forecast fetch/derivation failing shouldn't block selecting the event - Conditions
      // page still works via manual entry, same as an event with no forecast at all.
      console.error(JSON.stringify({ level: "error", msg: "planner.select_session.forecast_failed", message: err?.message ?? String(err) }));
    }
  } else if ((existingProfileCount?.n ?? 0) > 0) {
    const rows = await DB.prepare(`SELECT * FROM event_condition_profiles WHERE event_id = ? ORDER BY window_offset_start_minutes ASC`)
      .bind(eventId)
      .all<any>();
    conditionProfiles = rows.results ?? [];
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  const existingPlans = await listVisiblePlansForEvent(DB, eventId, viewerIdentity);

  let newPlanId: string | undefined;
  if (existingPlans.length === 0) {
    try {
      const plan = await createRacePlan(DB, { eventId, createdByUserId: viewer.user!.id, teamId });
      newPlanId = plan.id;
    } catch (err: any) {
      if (!(err instanceof CreateRacePlanError)) throw err;
      // event was just upserted above, so this shouldn't happen - fall through without a
      // plan rather than 500ing the whole selection.
    }
  }

  return json({ ok: true, event, conditionProfiles, existingPlans, newPlanId });
}
