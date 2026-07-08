import { computeCleanPace, type StoredLap } from "../../../../_lib/cleanPace";
import { json, jsonError } from "../../../../_lib/httpJson";

function clampN(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(50, Math.trunc(n));
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  // Qualifying is conventionally a single flying lap; race pace is an
  // average of several - default each independently rather than sharing one N.
  const qualLaps = clampN(url.searchParams.get("qualLaps") ?? url.searchParams.get("laps"), 1);
  const raceLaps = clampN(url.searchParams.get("raceLaps") ?? url.searchParams.get("laps"), 5);

  const subsession = await DB.prepare(`SELECT subsession_id FROM pace_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName, l.simsession_type as simsessionType,
            l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean
     FROM pace_laps l
     LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.subsession_id = ?`
  )
    .bind(subsessionId)
    .all<any>();

  type Key = string;
  const groups = new Map<Key, { custId: string; driverName: string; simsessionType: string; laps: StoredLap[] }>();

  for (const row of rows.results ?? []) {
    const key = `${row.simsessionType}:${row.custId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        custId: row.custId,
        driverName: row.driverName ?? `Driver ${row.custId}`,
        simsessionType: row.simsessionType,
        laps: [],
      });
    }
    groups.get(key)!.laps.push({
      lapTimeMs: row.lapTimeMs,
      isPitLap: Boolean(row.isPitLap),
      isClean: row.isClean === null ? null : Boolean(row.isClean),
    });
  }

  // One row per driver, with qualifying and race pace side by side.
  const byDriver = new Map<string, { custId: string; driverName: string; qualifying: unknown; race: unknown }>();

  for (const g of groups.values()) {
    if (!byDriver.has(g.custId)) {
      byDriver.set(g.custId, { custId: g.custId, driverName: g.driverName, qualifying: null, race: null });
    }
    const entry = byDriver.get(g.custId)!;
    const n = g.simsessionType === "qualifying" ? qualLaps : raceLaps;
    const result = { ...computeCleanPace(g.laps, n) };
    if (g.simsessionType === "qualifying") entry.qualifying = result;
    else entry.race = result;
  }

  return json({ ok: true, subsessionId, qualLaps, raceLaps, drivers: Array.from(byDriver.values()) });
}
