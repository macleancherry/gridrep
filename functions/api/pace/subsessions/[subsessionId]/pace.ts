import { computeCleanPace, type StoredLap } from "../../../../_lib/cleanPace";
import { json, jsonError } from "../../../../_lib/httpJson";

function clampN(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, max);
  return Math.min(max, Math.trunc(n));
}

// Fallback only: used when iRacing's own per-driver incident total (synced
// into pace_participants, see paceIngest.ts) isn't available for this
// subsession yet. Off track is 1x, car contact and losing control are 2x -
// iRacing doesn't publish this weighting as an API field, so it's an
// estimate, not a guaranteed match to iRacing's real total.
function pointsForFlag(flag: string): number {
  const f = flag.toLowerCase();
  if (f.includes("contact") || f.includes("lost control")) return 2;
  return 1;
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);

  const subsession = await DB.prepare(`SELECT subsession_id FROM pace_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName, l.simsession_type as simsessionType,
            l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean,
            l.flags_decoded as flagsDecoded, pp.incidents as officialIncidents
     FROM pace_laps l
     LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     LEFT JOIN pace_participants pp
       ON pp.subsession_id = l.subsession_id AND pp.cust_id = l.cust_id AND pp.simsession_type = l.simsession_type
     WHERE l.subsession_id = ?`
  )
    .bind(subsessionId)
    .all<any>();

  type Key = string;
  const groups = new Map<
    Key,
    { custId: string; driverName: string; simsessionType: string; laps: StoredLap[]; officialIncidents: number | null }
  >();
  const flagStatsByDriver = new Map<string, { points: number; lapsAffected: number; types: Record<string, number> }>();

  for (const row of rows.results ?? []) {
    const key = `${row.simsessionType}:${row.custId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        custId: row.custId,
        driverName: row.driverName ?? `Driver ${row.custId}`,
        simsessionType: row.simsessionType,
        laps: [],
        officialIncidents: row.officialIncidents === null || row.officialIncidents === undefined ? null : Number(row.officialIncidents),
      });
    }
    groups.get(key)!.laps.push({
      lapTimeMs: row.lapTimeMs,
      isPitLap: Boolean(row.isPitLap),
      isClean: row.isClean === null ? null : Boolean(row.isClean),
    });

    // Incidents = non-pit laps carrying at least one flag (off track, contact,
    // black flag, etc.) - a pit lap alone isn't an incident. Tallies whatever
    // flag strings iRacing actually returned, so the breakdown reflects real
    // data rather than a guessed taxonomy.
    if (!row.isPitLap) {
      let flags: string[] = [];
      try {
        flags = JSON.parse(row.flagsDecoded ?? "[]");
      } catch {
        flags = [];
      }
      if (flags.length > 0) {
        if (!flagStatsByDriver.has(row.custId)) flagStatsByDriver.set(row.custId, { points: 0, lapsAffected: 0, types: {} });
        const stats = flagStatsByDriver.get(row.custId)!;
        stats.lapsAffected += 1;
        for (const flag of flags) {
          stats.points += pointsForFlag(flag);
          stats.types[flag] = (stats.types[flag] ?? 0) + 1;
        }
      }
    }
  }

  // iRacing reports a real per-(driver, sim-session) incident total in its
  // own result payload (synced into pace_participants) - prefer summing
  // that across qualifying+race over the flag-weighted estimate whenever
  // it's actually present.
  const officialIncidentsByDriver = new Map<string, { sum: number; found: boolean }>();
  for (const g of groups.values()) {
    if (!officialIncidentsByDriver.has(g.custId)) officialIncidentsByDriver.set(g.custId, { sum: 0, found: false });
    const acc = officialIncidentsByDriver.get(g.custId)!;
    if (g.officialIncidents !== null) {
      acc.sum += g.officialIncidents;
      acc.found = true;
    }
  }

  // "Best N" used to be capped at a flat 50 regardless of how long the
  // session actually was - for a long enduro that's well short of every
  // clean lap someone ran. Cap against whatever's actually there instead:
  // the most laps any one driver has recorded for that sim-session type.
  let qualLapsAvailable = 1;
  let raceLapsAvailable = 1;
  for (const g of groups.values()) {
    if (g.simsessionType === "qualifying") qualLapsAvailable = Math.max(qualLapsAvailable, g.laps.length);
    else raceLapsAvailable = Math.max(raceLapsAvailable, g.laps.length);
  }

  // Qualifying is conventionally a single flying lap; race pace is an
  // average of several - default each independently rather than sharing one N.
  const qualLaps = clampN(url.searchParams.get("qualLaps") ?? url.searchParams.get("laps"), 1, qualLapsAvailable);
  const raceLaps = clampN(url.searchParams.get("raceLaps") ?? url.searchParams.get("laps"), 5, raceLapsAvailable);

  // One row per driver, with qualifying and race pace side by side, plus an
  // overall average across whichever laps qualifying/race actually used.
  const byDriver = new Map<
    string,
    {
      custId: string;
      driverName: string;
      qualifying: unknown;
      race: unknown;
      average: unknown;
      incidents: { total: number; estimated: boolean; lapsAffected: number; types: Record<string, number> };
    }
  >();

  for (const g of groups.values()) {
    if (!byDriver.has(g.custId)) {
      const official = officialIncidentsByDriver.get(g.custId);
      const flagStats = flagStatsByDriver.get(g.custId) ?? { points: 0, lapsAffected: 0, types: {} };
      byDriver.set(g.custId, {
        custId: g.custId,
        driverName: g.driverName,
        qualifying: null,
        race: null,
        average: null,
        incidents: official?.found
          ? { total: official.sum, estimated: false, lapsAffected: flagStats.lapsAffected, types: flagStats.types }
          : { total: flagStats.points, estimated: true, lapsAffected: flagStats.lapsAffected, types: flagStats.types },
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

  return json({
    ok: true,
    subsessionId,
    qualLaps,
    raceLaps,
    qualLapsAvailable,
    raceLapsAvailable,
    drivers: Array.from(byDriver.values()),
  });
}
