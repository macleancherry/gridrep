import { ensureDriverIds, displayDrivers } from "../../../../_lib/driverIdentity";
import { json, jsonError } from "../../../../_lib/httpJson";

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;

  const subsession = await DB.prepare(
    `SELECT subsession_id, league_id, event_id, track_name, series_name, start_time, ingested_at,
            track_temp as trackTemp, air_temp as airTemp, track_state as trackState, time_of_day as timeOfDay
     FROM planner_iracing_subsessions WHERE subsession_id = ?`
  )
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  const laps = await DB.prepare(
    `SELECT l.cust_id as custId, l.simsession_number as simsessionNumber,
            l.simsession_type as simsessionType, l.lap_number as lapNumber, l.lap_time_ms as lapTimeMs,
            l.is_pit_lap as isPitLap, l.is_clean as isClean, l.flags_decoded as flagsDecoded
     FROM planner_iracing_laps l
     WHERE l.subsession_id = ?
     ORDER BY l.simsession_type, l.cust_id, l.lap_number`
  )
    .bind(subsessionId)
    .all<any>();

  const driverIdByCustId = await ensureDriverIds(DB, (laps.results ?? []).map((l: any) => l.custId));
  const display = await displayDrivers(DB, [...driverIdByCustId.values()]);

  return json({
    ok: true,
    subsession,
    laps: (laps.results ?? []).map((l: any) => ({
      driverId: driverIdByCustId.get(l.custId),
      driverName: display.get(driverIdByCustId.get(l.custId)!)?.name ?? null,
      simsessionNumber: l.simsessionNumber,
      simsessionType: l.simsessionType,
      lapNumber: l.lapNumber,
      lapTimeMs: l.lapTimeMs,
      isPitLap: Boolean(l.isPitLap),
      isClean: l.isClean === null ? null : Boolean(l.isClean),
      flagsDecoded: (() => {
        try {
          return JSON.parse(l.flagsDecoded ?? "[]");
        } catch {
          return [];
        }
      })(),
    })),
  });
}
