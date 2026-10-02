import { ensureDriverIds, displayDriversForViewer } from "../../../_lib/driverIdentity";
import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const viewer = await getViewer(context);
  const viewerCustId = viewer.verified ? viewer.user!.iracingId : null;

  const subsession = await DB.prepare(
    `SELECT subsession_id, league_id, track_name, series_name, start_time, ingested_at
     FROM pace_subsessions WHERE subsession_id = ?`
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
     FROM pace_laps l
     WHERE l.subsession_id = ?
     ORDER BY l.simsession_type, l.cust_id, l.lap_number`
  )
    .bind(subsessionId)
    .all<any>();

  const driverIdByCustId = await ensureDriverIds(DB, (laps.results ?? []).map((l: any) => l.custId));
  const display = await displayDriversForViewer(DB, [...driverIdByCustId.values()], viewerCustId);

  return json({
    ok: true,
    subsession,
    laps: (laps.results ?? []).map((l: any) => {
      const driverId = driverIdByCustId.get(l.custId);
      return {
        driverId,
        driverName: driverId ? display.get(driverId)?.name ?? null : null,
        isSelf: driverId ? display.get(driverId)?.isSelf ?? false : false,
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
      };
    }),
  });
}
