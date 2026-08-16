/**
 * "What If" standings: pure function over already-stored race laps
 * (What If reuses Pace's pace_laps table - same subsession ingestion,
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
 *
 * Laps completed vs. time: a driver who fell out of the race (or is simply
 * slower over a lot of laps) covers fewer laps in the window than someone
 * who ran the whole thing - and fewer laps almost always means a *smaller*
 * summed total time, which would wrongly rank them ahead of drivers who
 * actually went further. A raw total-time comparison is only valid between
 * drivers who covered the exact same distance (even a 1-lap difference
 * makes it invalid - that missing lap's worth of time, ~equal to a real
 * gap, is enough to flip the order). So classified drivers are ranked the
 * way real race results are: primarily by laps completed since the cutoff
 * (most laps first), and only use total time to break ties between drivers
 * on the same number of laps.
 */

export type WhatIfLap = {
  lapNumber: number;
  lapTimeMs: number | null;
  isPitLap: boolean;
};

export type WhatIfDriverInput = {
  custId: string;
  driverName: string;
  laps: WhatIfLap[];
};

export type WhatIfStandingRow = {
  custId: string;
  driverName: string;
  position: number | null; // null = not classified (see status)
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  gapMs: number | null; // to the leader; only set when this driver covered the exact same distance as the leader (see lapsDown)
  lapsDown: number; // 0 = same distance as whoever went furthest; 1+ = that many laps behind
  lapsUsed: number; // laps counted from fromLap onward, timed or pit-substituted
  lapsInRange: number; // laps present from fromLap onward, whether counted or not - also the distance metric behind lapsDown
  lastLapNumber: number | null; // last lap number this driver has any record of, at all
  partial: boolean; // some laps from fromLap onward couldn't be counted or estimated
  pitLapsEstimated: number; // pit laps whose time was replaced by estimated pace (0 unless excludePitLaps)
};

function hasTime(l: WhatIfLap): l is WhatIfLap & { lapTimeMs: number } {
  return typeof l.lapTimeMs === "number" && l.lapTimeMs > 0;
}

function average(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function computeWhatIfStandings(
  drivers: WhatIfDriverInput[],
  fromLap: number,
  options: { excludePitLaps?: boolean } = {}
): WhatIfStandingRow[] {
  const excludePitLaps = options.excludePitLaps ?? false;
  const classified: Array<WhatIfStandingRow & { distance: number }> = [];
  const unclassified: WhatIfStandingRow[] = [];

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
      lapsDown: 0,
    };

    if (!reachedCutoff) {
      unclassified.push({ ...base, position: null, status: "dnf_before_cutoff", totalTimeMs: null, gapMs: null });
    } else if (lapsUsed === 0) {
      unclassified.push({ ...base, position: null, status: "no_timed_laps", totalTimeMs: null, gapMs: null });
    } else {
      classified.push({
        ...base,
        position: null,
        status: "classified",
        totalTimeMs,
        gapMs: null,
        distance: lapsInRange.length,
      });
    }
  }

  // Laps completed decides order first; total time only breaks ties between
  // drivers on the same number of laps - see the header comment for why a
  // raw time comparison across different lap counts is never valid, not
  // even by a single lap.
  classified.sort((a, b) => {
    if (a.distance !== b.distance) return b.distance - a.distance;
    return (a.totalTimeMs as number) - (b.totalTimeMs as number);
  });

  const maxDistance = classified[0]?.distance ?? 0;
  const leaderTimeMs = classified[0]?.totalTimeMs ?? null;
  classified.forEach((row, i) => {
    row.position = i + 1;
    row.lapsDown = Math.max(0, maxDistance - row.distance);
    // A raw time gap only means something between drivers who covered the
    // exact same distance - for anyone even a single lap down, their
    // smaller total time is an artifact of less distance, not more pace, so
    // the lap deficit (lapsDown) is the meaningful figure instead.
    row.gapMs = i === 0 || leaderTimeMs === null || row.lapsDown > 0 ? null : (row.totalTimeMs as number) - leaderTimeMs;
  });

  // Drivers who never reached the cutoff, or went furthest before dropping
  // out, are more "finished" than ones who fell out earlier - list them in
  // that order rather than arbitrarily.
  unclassified.sort((a, b) => (b.lastLapNumber ?? -1) - (a.lastLapNumber ?? -1));

  return [...classified.map(({ distance, ...row }) => row), ...unclassified];
}
