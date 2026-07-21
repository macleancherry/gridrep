import { computeCleanPace, type StoredLap } from "./plannerCleanPace";
import { resolveGarage61Fuel } from "./plannerGarage61Fuel";
import { resolveGarage61PitTime } from "./plannerGarage61PitTime";

/**
 * "Closest conditions" matching (PRD §6): filter a driver's laps at a track to those run
 * within a band of the target condition profile's temp range, widening progressively if
 * too few match, and flagging in the result when a widened band was needed - transparency
 * over silently averaging low-confidence data, per the PRD.
 */
const BAND_WIDTHS_C = [3, 5, 8, 12, 20];
const DEFAULT_BEST_N = 5;

export type LapRow = StoredLap & { trackTemp: number | null };

export type DriverProfileResult = {
  custId: string;
  trackName: string;
  paceMs: number | null;
  lapsUsed: number;
  sampleSize: number;
  widenedBand: boolean;
  bandWidthC: number | null;
  ok: boolean;
  reason?: "no_clean_laps" | "no_laps_at_track";
};

function withinBand(trackTemp: number | null, tempMid: number | null, bandWidth: number): boolean {
  if (tempMid === null) return true; // no target temp on the profile - don't filter by temp
  if (trackTemp === null) return false; // lap's session has no recorded temp - can't confirm it matches
  return Math.abs(trackTemp - tempMid) <= bandWidth;
}

export function computeDriverTrackProfile(
  custId: string,
  trackName: string,
  laps: LapRow[],
  opts: { tempMid?: number | null; bestN?: number } = {}
): DriverProfileResult {
  const bestN = opts.bestN ?? DEFAULT_BEST_N;
  const tempMid = opts.tempMid ?? null;

  if (laps.length === 0) {
    return { custId, trackName, paceMs: null, lapsUsed: 0, sampleSize: 0, widenedBand: false, bandWidthC: null, ok: false, reason: "no_laps_at_track" };
  }

  // No target temp to band against - use every clean lap at the track, no widening needed.
  if (tempMid === null) {
    const result = computeCleanPace(laps, bestN);
    return result.ok
      ? { custId, trackName, paceMs: result.paceMs, lapsUsed: result.lapsUsed, sampleSize: laps.length, widenedBand: false, bandWidthC: null, ok: true }
      : { custId, trackName, paceMs: null, lapsUsed: 0, sampleSize: laps.length, widenedBand: false, bandWidthC: null, ok: false, reason: "no_clean_laps" };
  }

  let lastAttempt: { result: ReturnType<typeof computeCleanPace>; sampleSize: number; band: number } | null = null;

  for (let i = 0; i < BAND_WIDTHS_C.length; i++) {
    const band = BAND_WIDTHS_C[i];
    const matched = laps.filter((l) => withinBand(l.trackTemp, tempMid, band));
    const result = computeCleanPace(matched, bestN);
    lastAttempt = { result, sampleSize: matched.length, band };

    if (result.ok && !result.partial) {
      return {
        custId,
        trackName,
        paceMs: result.paceMs,
        lapsUsed: result.lapsUsed,
        sampleSize: matched.length,
        widenedBand: i > 0,
        bandWidthC: band,
        ok: true,
      };
    }
  }

  // Ran out of bands to widen - use the widest attempt's result even if partial/empty,
  // and say so clearly rather than pretending it's a confident best-N average.
  if (lastAttempt?.result.ok) {
    return {
      custId,
      trackName,
      paceMs: lastAttempt.result.paceMs,
      lapsUsed: lastAttempt.result.lapsUsed,
      sampleSize: lastAttempt.sampleSize,
      widenedBand: true,
      bandWidthC: lastAttempt.band,
      ok: true,
    };
  }

  return {
    custId,
    trackName,
    paceMs: null,
    lapsUsed: 0,
    sampleSize: lastAttempt?.sampleSize ?? 0,
    widenedBand: true,
    bandWidthC: lastAttempt?.band ?? null,
    ok: false,
    reason: "no_clean_laps",
  };
}

/**
 * Derives an estimated real pit-stop time from lap-time deltas (migration 0012's
 * driver_track_profiles.pit_time_seconds/pit_time_source were scaffolded for exactly this
 * - "derive it from in-lap/out-lap deltas... follow-up work" - never computed until now).
 *
 * A pit lap's recorded lap_time_ms already includes the driver's own in/out-lap execution
 * plus the stationary stop itself (confirmed live: is_pit_lap is a per-lap flag, not a
 * separate in/out pair - unconfirmed whether iRacing ever splits it into two laps for some
 * payload shapes, so this treats it as one combined lap, the more common case). Delta
 * against the driver's own clean pace approximates total time lost to the stop.
 *
 * Sanity-bounded to (0, 3x clean pace) to exclude caution-lap/anomaly outliers (a full
 * extra lap under yellow, a spin into the pits) - not a confirmed physical bound, just a
 * generous filter. Takes the median across valid deltas (robust to one bad sample) and
 * returns null with zero valid data points rather than guessing.
 */
export function computePitTimeSeconds(laps: StoredLap[], cleanPaceMs: number | null): number | null {
  if (cleanPaceMs === null || cleanPaceMs <= 0) return null;

  const deltas = laps
    .filter((l) => l.isPitLap && typeof l.lapTimeMs === "number" && l.lapTimeMs > 0)
    .map((l) => (l.lapTimeMs as number) - cleanPaceMs)
    .filter((d) => d > 0 && d < cleanPaceMs * 3)
    .sort((a, b) => a - b);

  if (deltas.length === 0) return null;

  const mid = Math.floor(deltas.length / 2);
  const medianMs = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];

  return Math.round((medianMs / 1000) * 10) / 10; // one decimal place
}

export function driverProfileRowId(custId: string, trackName: string, conditionProfileId: string | null): string {
  return `${custId}:${trackName}:${conditionProfileId ?? "none"}`;
}

export type ComputeAndStoreOpts = {
  custId: string;
  trackName: string;
  trackConfig: string | null;
  conditionProfileId: string | null;
  tempMid: number | null;
  garage61TeamSlug: string | null;
  fuelOverride?: number;
};

export type StoredDriverProfileResult = {
  custId: string;
  driverName: string;
  trackName: string;
  conditionProfileId: string | null;
  ok: boolean;
  reason?: "no_clean_laps" | "no_laps_at_track";
  paceMs: number | null;
  lapsUsed: number;
  sampleSize: number;
  widenedBand: boolean;
  bandWidthC: number | null;
  fuelPerLap: number | null;
  fuelSource: string | null;
  pitTimeSeconds: number | null;
  pitTimeSource: string | null;
};

/**
 * Computes and persists one driver's track/condition profile - pace (this file's own
 * computeDriverTrackProfile), pit time (computePitTimeSeconds, falling back to Garage 61's
 * directly-reported pitlane data), and fuel-per-lap (Garage 61, respecting a previously
 * saved manual override). Extracted from driver-profiles.ts's POST handler so the
 * lineup-add background trigger (functions/api/planner/race-plans/[planId]/lineup.ts) can
 * compute a profile the moment a driver's laps are found, without a coordinator ever
 * needing to visit this page and click a "compute" button themselves.
 */
export async function computeAndStoreOneDriverProfile(context: any, DB: any, opts: ComputeAndStoreOpts): Promise<StoredDriverProfileResult> {
  const { custId, trackName, trackConfig, conditionProfileId, tempMid, garage61TeamSlug, fuelOverride } = opts;

  const lapsRes = await DB.prepare(
    `SELECT l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean, s.track_temp as trackTemp
     FROM planner_iracing_laps l
     JOIN planner_iracing_subsessions s ON s.subsession_id = l.subsession_id
     WHERE s.track_name = ? AND l.cust_id = ?`
  )
    .bind(trackName, custId)
    .all<any>();

  const laps: LapRow[] = (lapsRes.results ?? []).map((r: any) => ({
    lapTimeMs: r.lapTimeMs,
    isPitLap: Boolean(r.isPitLap),
    isClean: r.isClean === null ? null : Boolean(r.isClean),
    trackTemp: r.trackTemp,
  }));

  const computed = computeDriverTrackProfile(custId, trackName, laps, { tempMid });
  let pitTimeSeconds = computePitTimeSeconds(laps, computed.paceMs);
  let pitTimeSource: string | null = pitTimeSeconds === null ? null : "derived";

  if (pitTimeSeconds === null) {
    const garage61PitTime = await resolveGarage61PitTime(context, DB, custId, trackName, trackConfig);
    if (garage61PitTime !== null) {
      pitTimeSeconds = garage61PitTime;
      pitTimeSource = "garage61_derived";
    }
  }

  const rowId = driverProfileRowId(custId, trackName, conditionProfileId);
  const existing = await DB.prepare(`SELECT fuel_per_lap as fuelPerLap, fuel_source as fuelSource FROM driver_track_profiles WHERE id = ?`)
    .bind(rowId)
    .first<any>();

  let fuelPerLap: number | null;
  let fuelSource: string | null;

  if (typeof fuelOverride === "number" && Number.isFinite(fuelOverride)) {
    // An explicit manual entry for this call always wins - never overwritten by a guess.
    fuelPerLap = fuelOverride;
    fuelSource = "manual";
  } else if (existing?.fuelSource === "manual") {
    // A human already vetted this value - don't silently clobber it with real data that
    // might reflect a different car/conditions than what they actually confirmed.
    fuelPerLap = existing.fuelPerLap;
    fuelSource = existing.fuelSource;
  } else {
    const garage61Result = await resolveGarage61Fuel(context, DB, custId, trackName, trackConfig, garage61TeamSlug);
    if (garage61Result) {
      fuelPerLap = garage61Result.fuelPerLap;
      fuelSource = garage61Result.source;
    } else {
      fuelPerLap = existing?.fuelPerLap ?? null;
      fuelSource = fuelPerLap === null ? null : (existing?.fuelSource ?? "manual");
    }
  }

  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO driver_track_profiles (
       id, cust_id, track_name, condition_profile_id, pace_ms, laps_used, sample_size,
       widened_band, fuel_per_lap, fuel_source, pit_time_seconds, pit_time_source, computed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pace_ms = excluded.pace_ms,
       laps_used = excluded.laps_used,
       sample_size = excluded.sample_size,
       widened_band = excluded.widened_band,
       fuel_per_lap = excluded.fuel_per_lap,
       fuel_source = excluded.fuel_source,
       pit_time_seconds = excluded.pit_time_seconds,
       pit_time_source = excluded.pit_time_source,
       computed_at = excluded.computed_at`
  )
    .bind(
      rowId,
      custId,
      trackName,
      conditionProfileId,
      computed.paceMs,
      computed.lapsUsed,
      computed.sampleSize,
      computed.widenedBand ? 1 : 0,
      fuelPerLap,
      fuelSource,
      pitTimeSeconds,
      pitTimeSource,
      now
    )
    .run();

  const driver = await DB.prepare(`SELECT display_name as driverName FROM drivers WHERE iracing_member_id = ?`).bind(custId).first<any>();

  return {
    custId,
    driverName: driver?.driverName ?? `Driver ${custId}`,
    trackName,
    conditionProfileId,
    ok: computed.ok,
    reason: computed.reason,
    paceMs: computed.paceMs,
    lapsUsed: computed.lapsUsed,
    sampleSize: computed.sampleSize,
    widenedBand: computed.widenedBand,
    bandWidthC: computed.bandWidthC,
    fuelPerLap,
    fuelSource,
    pitTimeSeconds,
    pitTimeSource,
  };
}
