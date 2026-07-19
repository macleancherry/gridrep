import { getViewer, getValidAccessToken } from "../../../../../_lib/auth";
import {
  getCachedSeasonList,
  extractSchedulesForSeries,
  fetchWeatherForecast,
  raceStartOffsetMinutes,
  describeIracingError,
} from "../../../../../_lib/plannerIracing";
import { json, jsonError } from "../../../../../_lib/httpJson";

/**
 * Backfill for events selected before the visual forecast chart existed (migration
 * 0015) - event_forecast_hours only gets populated at select-session time, so any event
 * picked before that shipped has the bucketed Day/Dusk/Night/Dawn cards (from
 * event_condition_profiles) but no raw hourly data for the chart. This re-derives the
 * same weatherUrl/lengths a fresh select-session call would see (schedule data is
 * static once a season exists) and captures the hours now, without touching the
 * already-saved condition profiles at all. No-ops if hours already exist - never
 * refetches/duplicates for an event that's already been captured.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to refresh the forecast." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT series_id as seriesId, season_id as seasonId FROM iracing_events WHERE id = ?`)
    .bind(eventId)
    .first<any>();

  if (!event?.seriesId || !event?.seasonId) {
    return jsonError(404, { error: "event_not_found", message: "Event not found, or has no linked series to refresh from." });
  }

  const existing = await DB.prepare(`SELECT COUNT(*) as n FROM event_forecast_hours WHERE event_id = ?`).bind(eventId).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return json({ ok: true, alreadyCaptured: true, hoursInserted: 0 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to refresh the forecast." });
  }

  let payload: any;
  try {
    ({ payload } = await getCachedSeasonList(DB, accessToken));
  } catch (err: any) {
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not reach iRacing: ${describeIracingError(err)}` });
  }

  const schedules = extractSchedulesForSeries(payload, String(event.seriesId));
  const matched = schedules.find((s) => s.seasonId === String(event.seasonId) && s.weatherUrl);

  if (!matched?.weatherUrl) {
    return json({ ok: true, forecastAvailable: false, hoursInserted: 0, message: "No forecast available from iRacing for this event." });
  }

  let hours: Awaited<ReturnType<typeof fetchWeatherForecast>>;
  try {
    hours = await fetchWeatherForecast(matched.weatherUrl);
  } catch (err: any) {
    return jsonError(502, { error: "forecast_fetch_failed", message: `Could not fetch the forecast: ${describeIracingError(err)}` });
  }

  const raceStart = raceStartOffsetMinutes(matched);

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

  return json({ ok: true, hoursInserted: hours.length });
}
