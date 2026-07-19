import { json } from "../../../../_lib/httpJson";

/**
 * Raw hourly forecast timeline for an event (see migration 0015) - the data source for
 * the visual forecast chart on the Conditions page. Distinct from GET .../conditions,
 * which returns the bucketed Day/Dusk/Night/Dawn summary cards used for stint-time
 * filtering; this keeps every hour so the chart can show the real shape of the forecast.
 * Empty for events with no real forecast (manual-entry-only events) - the frontend
 * should simply not render a chart in that case.
 */
export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const rows = await DB.prepare(
    `SELECT time_offset_minutes as timeOffsetMinutes, is_sun_up as isSunUp, air_temp_c as airTempC,
            precip_chance_pct as precipChancePct, cloud_cover_pct as cloudCoverPct, wind_speed as windSpeed
     FROM event_forecast_hours WHERE event_id = ? ORDER BY time_offset_minutes ASC`
  )
    .bind(eventId)
    .all<any>();

  const hours = (rows.results ?? []).map((r: any) => ({ ...r, isSunUp: Boolean(r.isSunUp) }));

  return json({ ok: true, eventId, hours });
}
