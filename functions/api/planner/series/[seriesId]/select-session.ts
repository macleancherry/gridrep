import { getViewer } from "../../../../_lib/auth";
import { upsertIracingEvent, fetchWeatherForecast, deriveConditionProfilesFromForecast } from "../../../../_lib/plannerIracing";
import { createRacePlan, listVisiblePlansForEvent, CreateRacePlanError } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Step 3: selecting a specific session. Body is the exact ScheduleSession (+ series name)
 * shape GET .../sessions already returned, POSTed back - same "client echoes back what it
 * was given" pattern events/select.ts uses, avoiding a second iRacing fetch just to
 * re-locate the same schedule entry server-side.
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

  const eventId = `season-${seasonId}`;
  const { DB } = context.env;

  const event = await upsertIracingEvent(DB, {
    id: eventId,
    name: typeof body?.scheduleName === "string" && body.scheduleName.trim() ? body.scheduleName.trim() : seriesName,
    trackName: body?.trackName ?? null,
    trackConfig: body?.trackConfig ?? null,
    eventType: "special",
    scheduledStartTime: body?.scheduledStartTime ?? null,
    durationMinutes: typeof body?.durationMinutes === "number" ? body.durationMinutes : null,
    seriesId,
    seasonId,
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
      const derived = deriveConditionProfilesFromForecast(hours);
      const now = new Date().toISOString();

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
      const plan = await createRacePlan(DB, { eventId, createdByUserId: viewer.user!.id });
      newPlanId = plan.id;
    } catch (err: any) {
      if (!(err instanceof CreateRacePlanError)) throw err;
      // event was just upserted above, so this shouldn't happen - fall through without a
      // plan rather than 500ing the whole selection.
    }
  }

  return json({ ok: true, event, conditionProfiles, existingPlans, newPlanId });
}
