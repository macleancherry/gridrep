import { computeRestartStandings, type RestartDriverInput } from "../../../../_lib/restartStandings";
import { json, jsonError } from "../../../../_lib/httpJson";

function clampFromLap(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const fromLap = clampFromLap(url.searchParams.get("fromLap"));

  const subsession = await DB.prepare(`SELECT subsession_id FROM pace_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  // Restart standings only make sense over the race stage - qualifying laps
  // don't count toward a finishing order. If a race has more than one
  // simsession_number tagged "race" (heat races), laps from all of them are
  // combined per driver, which is a reasonable default but worth knowing.
  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName, l.lap_number as lapNumber, l.lap_time_ms as lapTimeMs
     FROM pace_laps l
     LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.subsession_id = ? AND l.simsession_type = 'race'`
  )
    .bind(subsessionId)
    .all<any>();

  const byDriver = new Map<string, RestartDriverInput>();
  for (const row of rows.results ?? []) {
    if (!byDriver.has(row.custId)) {
      byDriver.set(row.custId, {
        custId: row.custId,
        driverName: row.driverName ?? `Driver ${row.custId}`,
        laps: [],
      });
    }
    byDriver.get(row.custId)!.laps.push({ lapNumber: row.lapNumber, lapTimeMs: row.lapTimeMs });
  }

  if (byDriver.size === 0) {
    return jsonError(404, {
      error: "no_race_laps",
      message: "No race laps found for this subsession yet - sync it first, or it may be qualifying-only.",
    });
  }

  const standings = computeRestartStandings(Array.from(byDriver.values()), fromLap);

  return json({ ok: true, subsessionId, fromLap, standings });
}
