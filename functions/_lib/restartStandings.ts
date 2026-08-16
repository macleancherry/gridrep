/**
 * "Restart" standings: pure function over already-stored race laps
 * (Restart reuses Pace's pace_laps table - same subsession ingestion,
 * a different computed view of it).
 *
 * Recomputes finishing order as if the race had started at a given lap
 * number: each driver's classification time is the sum of their lap times
 * from that lap through the last lap they completed, ignoring everything
 * before it (early-race incidents, a first-lap pileup, etc. drop out of
 * the picture entirely).
 *
 * excludePitLaps: drivers don't pit on the same lap as each other, so a
 * fixed lap window catches some drivers' pit stops and not others' - a stop
 * that happens to fall inside the window makes that driver look artificially
 * slower than one whose stop fell just before it (or hasn't happened yet).
 * Simply dropping a caught pit lap outright would trade that bias for the
 * opposite one - whoever gets a lap dropped is now covering less distance
 * than everyone else, making their total look artificially *shorter*. So
 * instead, a caught pit lap's time is replaced with that driver's own
 * average clean-lap pace for the window: the anomalous pit-lane time drops
 * out, but everyone's total still spans the same number of laps.
 */

export type RestartLap = {
  lapNumber: number;
  lapTimeMs: number | null;
  isPitLap: boolean;
};

export type RestartDriverInput = {
  custId: string;
  driverName: string;
  laps: RestartLap[];
};

export type RestartStandingRow = {
  custId: string;
  driverName: string;
  position: number | null; // null = not classified (see status)
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  gapMs: number | null; // to the leader; null for the leader and for unclassified drivers
  lapsUsed: number; // laps counted from fromLap onward, timed or pit-substituted
  lapsInRange: number; // laps present from fromLap onward, whether counted or not
  lastLapNumber: number | null; // last lap number this driver has any record of, at all
  partial: boolean; // some laps from fromLap onward couldn't be counted or estimated
  pitLapsEstimated: number; // pit laps whose time was replaced by estimated pace (0 unless excludePitLaps)
};

function hasTime(l: RestartLap): l is RestartLap & { lapTimeMs: number } {
  return typeof l.lapTimeMs === "number" && l.lapTimeMs > 0;
}

function average(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function computeRestartStandings(
  drivers: RestartDriverInput[],
  fromLap: number,
  options: { excludePitLaps?: boolean } = {}
): RestartStandingRow[] {
  const excludePitLaps = options.excludePitLaps ?? false;
  const classified: RestartStandingRow[] = [];
  const unclassified: RestartStandingRow[] = [];

  for (const d of drivers) {
    const sorted = [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber);
    const lastLapNumber = sorted.length > 0 ? sorted[sorted.length - 1].lapNumber : null;
    // Whether they reached the cutoff at all is about race distance, not
    // about which of those laps end up counted - always judged against every
    // lap on record, regardless of the pit-lap option below.
    const reachedCutoff = sorted.some((l) => l.lapNumber >= fromLap);
    const lapsInRange = sorted.filter((l) => l.lapNumber >= fromLap);

    let totalTimeMs = 0;
    let lapsUsed = 0;
    let pitLapsEstimated = 0;
    let partial = false;

    if (excludePitLaps) {
      const cleanInRange = lapsInRange.filter((l) => !l.isPitLap && hasTime(l));
      const pitInRange = lapsInRange.filter((l) => l.isPitLap);
      const otherMissingInRange = lapsInRange.filter((l) => !l.isPitLap && !hasTime(l));

      // Prefer the driver's own pace within this window; fall back to their
      // pace over the whole synced race if the window itself has no clean
      // lap to estimate from (e.g. every lap in range was a pit lap).
      const substituteMs =
        average(cleanInRange.map((l) => l.lapTimeMs)) ??
        average(sorted.filter((l) => !l.isPitLap && hasTime(l)).map((l) => l.lapTimeMs));

      totalTimeMs = cleanInRange.reduce((sum, l) => sum + l.lapTimeMs, 0);
      lapsUsed = cleanInRange.length;

      if (substituteMs !== undefined) {
        totalTimeMs += pitInRange.length * substituteMs;
        lapsUsed += pitInRange.length;
        pitLapsEstimated = pitInRange.length;
      } else if (pitInRange.length > 0) {
        partial = true; // no pace data anywhere to estimate a substitute from
      }

      if (otherMissingInRange.length > 0) partial = true;
    } else {
      const timed = lapsInRange.filter(hasTime);
      totalTimeMs = timed.reduce((sum, l) => sum + l.lapTimeMs, 0);
      lapsUsed = timed.length;
      partial = timed.length < lapsInRange.length;
    }

    const base = {
      custId: d.custId,
      driverName: d.driverName,
      lapsUsed,
      lapsInRange: lapsInRange.length,
      lastLapNumber,
      partial,
      pitLapsEstimated,
    };

    if (!reachedCutoff) {
      unclassified.push({ ...base, position: null, status: "dnf_before_cutoff", totalTimeMs: null, gapMs: null });
    } else if (lapsUsed === 0) {
      unclassified.push({ ...base, position: null, status: "no_timed_laps", totalTimeMs: null, gapMs: null });
    } else {
      classified.push({ ...base, position: null, status: "classified", totalTimeMs, gapMs: null });
    }
  }

  classified.sort((a, b) => (a.totalTimeMs as number) - (b.totalTimeMs as number));
  const leaderTimeMs = classified[0]?.totalTimeMs ?? null;
  classified.forEach((row, i) => {
    row.position = i + 1;
    row.gapMs = leaderTimeMs === null || i === 0 ? null : (row.totalTimeMs as number) - leaderTimeMs;
  });

  // Drivers who never reached the cutoff, or went furthest before dropping
  // out, are more "finished" than ones who fell out earlier - list them in
  // that order rather than arbitrarily.
  unclassified.sort((a, b) => (b.lastLapNumber ?? -1) - (a.lastLapNumber ?? -1));

  return [...classified, ...unclassified];
}
