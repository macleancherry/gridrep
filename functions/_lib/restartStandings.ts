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
 */

export type RestartLap = {
  lapNumber: number;
  lapTimeMs: number | null;
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
  lapsUsed: number; // timed laps counted from fromLap onward
  lapsInRange: number; // laps present from fromLap onward, timed or not
  lastLapNumber: number | null; // last lap number this driver has any record of, at all
  partial: boolean; // some laps from fromLap onward had no recorded time
};

export function computeRestartStandings(drivers: RestartDriverInput[], fromLap: number): RestartStandingRow[] {
  const classified: RestartStandingRow[] = [];
  const unclassified: RestartStandingRow[] = [];

  for (const d of drivers) {
    const sorted = [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber);
    const lastLapNumber = sorted.length > 0 ? sorted[sorted.length - 1].lapNumber : null;
    const lapsInRange = sorted.filter((l) => l.lapNumber >= fromLap);
    const timedLapsInRange = lapsInRange.filter((l) => typeof l.lapTimeMs === "number" && l.lapTimeMs! > 0);
    const totalTimeMs = timedLapsInRange.reduce((sum, l) => sum + (l.lapTimeMs as number), 0);

    const base = {
      custId: d.custId,
      driverName: d.driverName,
      lapsUsed: timedLapsInRange.length,
      lapsInRange: lapsInRange.length,
      lastLapNumber,
      partial: timedLapsInRange.length < lapsInRange.length,
    };

    if (lapsInRange.length === 0) {
      unclassified.push({ ...base, position: null, status: "dnf_before_cutoff", totalTimeMs: null, gapMs: null });
    } else if (timedLapsInRange.length === 0) {
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
