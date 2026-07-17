import { computeCleanPace, type StoredLap } from "./plannerCleanPace";

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
