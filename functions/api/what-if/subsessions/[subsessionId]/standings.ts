import { computeWhatIfStandings, computeCutoffTimeMs, type WhatIfDriverInput } from "../../../../_lib/whatIfStandings";
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
  const excludePitLaps = url.searchParams.get("excludePitLaps") === "true";
  const driverQuery = (url.searchParams.get("driver") ?? "").trim();

  if (!driverQuery) {
    return jsonError(400, {
      error: "driver_required",
      message:
        "Enter a driver name - it anchors the cutoff to the exact real moment that driver reached the given lap, so everyone else is compared from that same moment.",
    });
  }

  const subsession = await DB.prepare(`SELECT subsession_id FROM pace_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<any>();

  if (!subsession) {
    return jsonError(404, { error: "not_found", message: "Subsession has not been synced yet." });
  }

  // What If standings only make sense over the race stage - qualifying laps
  // don't count toward a finishing order. If a race has more than one
  // simsession_number tagged "race" (heat races), laps from all of them are
  // combined per driver, which is a reasonable default but worth knowing.
  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName, l.lap_number as lapNumber,
            l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean
     FROM pace_laps l
     LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.subsession_id = ? AND l.simsession_type = 'race'`
  )
    .bind(subsessionId)
    .all<any>();

  const byDriver = new Map<string, WhatIfDriverInput>();
  for (const row of rows.results ?? []) {
    if (!byDriver.has(row.custId)) {
      byDriver.set(row.custId, {
        custId: row.custId,
        driverName: row.driverName ?? `Driver ${row.custId}`,
        laps: [],
      });
    }
    byDriver.get(row.custId)!.laps.push({
      lapNumber: row.lapNumber,
      lapTimeMs: row.lapTimeMs,
      isPitLap: Boolean(row.isPitLap),
      isClean: row.isClean === null ? null : Boolean(row.isClean),
    });
  }

  if (byDriver.size === 0) {
    return jsonError(404, {
      error: "no_race_laps",
      message: "No race laps found for this subsession yet - sync it first, or it may be qualifying-only.",
    });
  }

  const driverQueryLower = driverQuery.toLowerCase();
  const matches = Array.from(byDriver.values()).filter((d) => d.driverName.toLowerCase().includes(driverQueryLower));

  if (matches.length === 0) {
    return jsonError(404, {
      error: "driver_not_found",
      message: `No driver matching "${driverQuery}" found in this subsession.`,
    });
  }
  if (matches.length > 1) {
    return jsonError(400, {
      error: "driver_ambiguous",
      message: `"${driverQuery}" matches more than one driver - be more specific: ${matches.map((d) => d.driverName).join(", ")}.`,
    });
  }

  const referenceDriver = matches[0];
  const cutoffTimeMs = computeCutoffTimeMs(referenceDriver.laps, fromLap);

  if (cutoffTimeMs === null) {
    return jsonError(400, {
      error: "reference_driver_dnf_before_cutoff",
      message: `${referenceDriver.driverName} never reached lap ${fromLap} in this race - pick an earlier lap.`,
    });
  }

  const standings = computeWhatIfStandings(Array.from(byDriver.values()), cutoffTimeMs, { excludePitLaps });

  // "Near the reference driver" gates the average-pace comparison to drivers
  // who covered roughly the same distance in the window - comparing pace
  // between someone on-lead-lap and someone several laps down (who may have
  // had a very different race: an early spin, a long repair, traffic) isn't
  // meaningful the way it is between two drivers who ran a comparable stretch.
  const referenceRow = standings.find((r) => r.custId === referenceDriver.custId);
  const referenceDistance = referenceRow?.lapsInRange ?? 0;
  const standingsWithProximity = standings.map((r) => ({
    ...r,
    nearReference: r.status === "classified" && Math.abs(r.lapsInRange - referenceDistance) <= 2,
  }));

  return json({
    ok: true,
    subsessionId,
    fromLap,
    excludePitLaps,
    referenceDriver: { custId: referenceDriver.custId, driverName: referenceDriver.driverName },
    cutoffTimeMs,
    standings: standingsWithProximity,
  });
}
