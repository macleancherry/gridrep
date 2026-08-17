/**
 * "What If" standings: pure function over already-stored race laps
 * (What If reuses Pace's pace_laps table - same subsession ingestion,
 * a different computed view of it).
 *
 * Recomputes finishing order as if the race had restarted at the exact
 * real-world moment a chosen reference driver reached a given lap number -
 * not at "everyone's own lap N". Those are not the same thing: a faster
 * driver reaches lap N sooner in real time than a slower one does, so
 * counting from "my own lap 36" for every driver compares windows of
 * different real duration - the faster driver's window runs longer, so
 * they rack up more laps in it for no reason other than getting there
 * first, not for being faster *during* the window. (Confirmed against a
 * real subsession: two drivers a couple seconds apart on pace reached
 * "lap 36" over 4 minutes apart in real time, entirely because one pitted
 * earlier - enough of a head start to fabricate a 2-lap "lead" that
 * reversed once the cutoff was anchored to a single real moment instead.)
 * So the cutoff is computed once, from the reference driver's own
 * cumulative race time through the lap before the one entered, and every
 * driver's window is "whichever of their own laps started at or after
 * that same real moment" - not "lap number >= N".
 *
 * excludePitLaps: drivers don't pit at the same real moment as each other,
 * so a shared time cutoff can still catch one driver's pit stop inside the
 * window and not another's - a stop that happens to fall inside the window
 * makes that driver look artificially slower than one whose stop fell just
 * before it (or hasn't happened yet). Simply dropping a caught pit lap
 * outright would trade that bias for the opposite one - whoever gets a lap
 * dropped is now covering less distance than everyone else, making their
 * total look artificially *shorter*. So instead, a caught pit lap's time is
 * replaced with that driver's own average clean-lap pace for the window:
 * the anomalous pit-lane time drops out, but everyone's total still spans
 * the same number of laps.
 *
 * Laps completed vs. time: even with a real-time-synchronized cutoff, a
 * driver who fell out of the race still covers fewer laps in the window
 * than someone who kept going - and fewer laps almost always means a
 * *smaller* summed total time, which would wrongly rank them ahead of
 * drivers who actually went further. A raw total-time comparison is only
 * valid between drivers who covered the exact same distance (even a 1-lap
 * difference makes it invalid - that missing lap's worth of time, ~equal to
 * a real gap, is enough to flip the order). So classified drivers are
 * ranked the way real race results are: primarily by laps completed since
 * the cutoff (most laps first), and only use total time to break ties
 * between drivers on the same number of laps.
 *
 * avgLapMs: "laps completed" is still a whole-number count of however many
 * laps happened to fit in the window, so a driver whose own lap boundary
 * landed just before the cutoff (banking an extra lap) can outrank someone
 * genuinely just as fast, or faster, purely on that quantization - a
 * position/laps-completed answer and a "who was actually quicker" answer
 * aren't always the same question. avgLapMs (total time / laps used) is a
 * continuous pace figure that isn't sensitive to that rounding, meant to be
 * read as a second, complementary view - not a replacement for position.
 *
 * bestAdjustedLapMs / cleanLapMs: avgLapMs still includes every counted
 * lap, so a single incident, a spin, or a bit of lap traffic can drag it
 * around even though it says little about true pace. Two different ways to
 * strip that out:
 *  - bestAdjustedLapMs drops the slowest ~10% of counted laps (whatever
 *    they were - substituted pit laps included) and averages the rest, a
 *    statistical trim that works even without reliable incident data.
 *  - cleanLapMs averages only laps iRacing itself flagged as clean (no
 *    pit stop, no off-track/contact/etc.) - a stricter, incident-aware cut
 *    at the cost of being null if the driver has no clean laps at all in
 *    the window.
 */

export type WhatIfLap = {
  lapNumber: number;
  lapTimeMs: number | null;
  isPitLap: boolean;
  isClean: boolean | null;
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
  avgLapMs: number | null; // totalTimeMs / lapsUsed - a pace view that isn't affected by how many whole laps happened to fit in the window
  bestAdjustedLapMs: number | null; // average of the fastest ~90% of counted laps, dropping the slowest outliers
  cleanLapMs: number | null; // average of laps with no recorded incident/off-track (and no pit stop); null if none in range
  gapMs: number | null; // to the leader; only set when this driver covered the exact same distance as the leader (see lapsDown)
  lapsDown: number; // 0 = same distance as whoever went furthest; 1+ = that many laps behind
  lapsUsed: number; // laps counted from the cutoff onward, timed or pit-substituted
  lapsInRange: number; // laps present from the cutoff onward, whether counted or not - also the distance metric behind lapsDown
  lastLapNumber: number | null; // last lap number this driver has any record of, at all
  partial: boolean; // some laps from the cutoff onward couldn't be counted or estimated
  pitLapsEstimated: number; // pit laps whose time was replaced by estimated pace (0 unless excludePitLaps)
};

function hasTime(l: WhatIfLap): l is WhatIfLap & { lapTimeMs: number } {
  return typeof l.lapTimeMs === "number" && l.lapTimeMs > 0;
}

function average(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

// Drop the slowest ~10% of counted laps before averaging - enough to blunt
// one bad lap's effect on the pace figure without needing to know why it
// was slow, but not so aggressive it starts hiding genuine race pace.
const BEST_ADJUSTED_KEEP_FRACTION = 0.9;

function trimmedAverage(times: number[], keepFraction: number): number | undefined {
  if (times.length === 0) return undefined;
  const keepCount = Math.max(1, Math.floor(times.length * keepFraction));
  const sorted = [...times].sort((a, b) => a - b);
  return average(sorted.slice(0, keepCount));
}

/**
 * The reference driver's own cumulative race time through the end of the
 * lap before `fromLap` - i.e. the real moment they started `fromLap`. Uses
 * their actual recorded time (pit stops included) since this is meant to
 * pin down a real historical instant in the race, not a hypothetical one.
 * Returns null if they have no recorded lap at `fromLap` or later - the
 * "what if" doesn't make sense anchored to a lap they themselves never
 * reached.
 */
export function computeCutoffTimeMs(laps: WhatIfLap[], fromLap: number): number | null {
  const sorted = [...laps].sort((a, b) => a.lapNumber - b.lapNumber);
  if (!sorted.some((l) => l.lapNumber >= fromLap)) return null;

  let cumulative = 0;
  for (const lap of sorted) {
    if (lap.lapNumber >= fromLap) break;
    if (hasTime(lap)) cumulative += lap.lapTimeMs;
  }
  return cumulative;
}

export function computeWhatIfStandings(
  drivers: WhatIfDriverInput[],
  cutoffTimeMs: number,
  options: { excludePitLaps?: boolean } = {}
): WhatIfStandingRow[] {
  const excludePitLaps = options.excludePitLaps ?? false;
  const classified: Array<WhatIfStandingRow & { distance: number }> = [];
  const unclassified: WhatIfStandingRow[] = [];

  for (const d of drivers) {
    const sorted = [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber);
    const lastLapNumber = sorted.length > 0 ? sorted[sorted.length - 1].lapNumber : null;

    // Walk this driver's own laps in order, tracking their own cumulative
    // elapsed time - a lap is "in range" once that running total (the real
    // moment it started) has reached the shared cutoff. This is what makes
    // every driver's window start at the same real moment in the race,
    // regardless of how many laps each of them personally needed to get
    // there.
    let cumulative = 0;
    let reachedCutoff = false;
    const lapsInRange: WhatIfLap[] = [];
    for (const lap of sorted) {
      if (cumulative >= cutoffTimeMs) {
        reachedCutoff = true;
        lapsInRange.push(lap);
      }
      if (hasTime(lap)) cumulative += lap.lapTimeMs;
    }

    let countedTimesMs: number[] = [];
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

      countedTimesMs = cleanInRange.map((l) => l.lapTimeMs);

      if (substituteMs !== undefined) {
        countedTimesMs.push(...new Array(pitInRange.length).fill(substituteMs));
        pitLapsEstimated = pitInRange.length;
      } else if (pitInRange.length > 0) {
        partial = true; // no pace data anywhere to estimate a substitute from
      }

      if (otherMissingInRange.length > 0) partial = true;
    } else {
      const timed = lapsInRange.filter(hasTime);
      countedTimesMs = timed.map((l) => l.lapTimeMs);
      partial = timed.length < lapsInRange.length;
    }

    const totalTimeMs = countedTimesMs.reduce((sum, t) => sum + t, 0);
    const lapsUsed = countedTimesMs.length;

    // Clean pace always excludes pit laps outright (not substituted) and
    // only counts laps iRacing flagged with no incident/off-track, whether
    // or not excludePitLaps is on - it's a different, stricter question
    // ("how fast with nothing at all going wrong") than the rest of the row.
    const cleanTimesMs = lapsInRange
      .filter((l) => !l.isPitLap && l.isClean === true && hasTime(l))
      .map((l) => l.lapTimeMs);

    const base = {
      custId: d.custId,
      driverName: d.driverName,
      avgLapMs: lapsUsed > 0 ? totalTimeMs / lapsUsed : null,
      bestAdjustedLapMs: trimmedAverage(countedTimesMs, BEST_ADJUSTED_KEEP_FRACTION) ?? null,
      cleanLapMs: average(cleanTimesMs) ?? null,
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
