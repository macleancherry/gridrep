import { computeCleanPace, type StoredLap } from "../../../../_lib/cleanPace";
import { json, jsonError } from "../../../../_lib/httpJson";

function clampN(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(50, Math.trunc(n));
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const n = clampN(url.searchParams.get("laps"));

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

  const pace = Array.from(groups.values()).map((g) => ({
    custId: g.custId,
    driverName: g.driverName,
    simsessionType: g.simsessionType,
    ...computeCleanPace(g.laps, n),
  }));

  return json({ ok: true, subsessionId, n, pace });
}
