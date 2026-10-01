import { computeCleanPace, type StoredLap } from "../../../../../_lib/plannerCleanPace";
import { ensureDriverIds, displayDrivers } from "../../../../../_lib/driverIdentity";
import { json, jsonError } from "../../../../../_lib/httpJson";

function clampN(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(50, Math.trunc(n));
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const qualLaps = clampN(url.searchParams.get("qualLaps") ?? url.searchParams.get("laps"), 1);
  const raceLaps = clampN(url.searchParams.get("raceLaps") ?? url.searchParams.get("laps"), 5);

  const subsession = await DB.prepare(`SELECT subsession_id FROM planner_iracing_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, l.simsession_type as simsessionType,
            l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean,
            l.flags_decoded as flagsDecoded
     FROM planner_iracing_laps l
     WHERE l.subsession_id = ?`
  )
    .bind(subsessionId)
    .all<any>();

  const driverIdByCustId = await ensureDriverIds(DB, (rows.results ?? []).map((r: any) => r.custId));
  const display = await displayDrivers(DB, [...driverIdByCustId.values()]);

  type Key = string;
  const groups = new Map<Key, { custId: string; simsessionType: string; laps: StoredLap[] }>();
  const incidentsByDriver = new Map<string, { count: number; types: Record<string, number> }>();

  for (const row of rows.results ?? []) {
    const key = `${row.simsessionType}:${row.custId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        custId: row.custId,
        simsessionType: row.simsessionType,
        laps: [],
      });
    }
    groups.get(key)!.laps.push({
      lapTimeMs: row.lapTimeMs,
      isPitLap: Boolean(row.isPitLap),
      isClean: row.isClean === null ? null : Boolean(row.isClean),
    });

    if (!row.isPitLap) {
      let flags: string[] = [];
      try {
        flags = JSON.parse(row.flagsDecoded ?? "[]");
      } catch {
        flags = [];
      }
      if (flags.length > 0) {
        if (!incidentsByDriver.has(row.custId)) incidentsByDriver.set(row.custId, { count: 0, types: {} });
        const stats = incidentsByDriver.get(row.custId)!;
        stats.count += 1;
        for (const flag of flags) {
          stats.types[flag] = (stats.types[flag] ?? 0) + 1;
        }
      }
    }
  }

  const byDriver = new Map<
    string,
    {
      custId: string;
      qualifying: unknown;
      race: unknown;
      average: unknown;
      incidents: { count: number; types: Record<string, number> };
    }
  >();

  for (const g of groups.values()) {
    if (!byDriver.has(g.custId)) {
      byDriver.set(g.custId, {
        custId: g.custId,
        qualifying: null,
        race: null,
        average: null,
        incidents: incidentsByDriver.get(g.custId) ?? { count: 0, types: {} },
      });
    }
    const entry = byDriver.get(g.custId)!;
    const n = g.simsessionType === "qualifying" ? qualLaps : raceLaps;
    const result = computeCleanPace(g.laps, n);
    if (g.simsessionType === "qualifying") entry.qualifying = result;
    else entry.race = result;
  }

  for (const entry of byDriver.values()) {
    const qual = entry.qualifying as ReturnType<typeof computeCleanPace>;
    const race = entry.race as ReturnType<typeof computeCleanPace>;
    const combinedLapTimesMs = [...(qual?.ok ? qual.lapTimesMs : []), ...(race?.ok ? race.lapTimesMs : [])];

    if (combinedLapTimesMs.length === 0) {
      entry.average = { ok: false, reason: "no_clean_laps" };
    } else {
      const paceMs = combinedLapTimesMs.reduce((sum, t) => sum + t, 0) / combinedLapTimesMs.length;
      entry.average = { ok: true, paceMs, lapsUsed: combinedLapTimesMs.length };
    }
  }

  const drivers = Array.from(byDriver.values()).map(({ custId, ...rest }) => ({
    driverId: driverIdByCustId.get(custId),
    driverName: display.get(driverIdByCustId.get(custId)!)?.name ?? null,
    ...rest,
  }));

  return json({ ok: true, subsessionId, qualLaps, raceLaps, drivers });
}
