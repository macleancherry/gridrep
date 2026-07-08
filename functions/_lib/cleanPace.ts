/**
 * Clean-pace calculation: pure function over already-stored lap rows.
 * No network calls here, so pace can be recomputed cheaply if N or the
 * "clean lap" definition changes later (see classifyLap below).
 */

export type StoredLap = {
  lapTimeMs: number | null;
  isPitLap: boolean;
  isClean: boolean | null; // null = could not be classified from the stored payload
};

export type CleanPaceResult =
  | { ok: true; paceMs: number; lapsUsed: number; n: number }
  | { ok: false; reason: "insufficient_clean_laps"; cleanLapCount: number; n: number };

export function computeCleanPace(laps: StoredLap[], n = 5): CleanPaceResult {
  const cleanTimes = laps
    .filter((l) => l.isClean === true && !l.isPitLap && typeof l.lapTimeMs === "number" && l.lapTimeMs > 0)
    .map((l) => l.lapTimeMs as number)
    .sort((a, b) => a - b);

  if (cleanTimes.length < n) {
    return { ok: false, reason: "insufficient_clean_laps", cleanLapCount: cleanTimes.length, n };
  }

  const bestN = cleanTimes.slice(0, n);
  const paceMs = bestN.reduce((sum, t) => sum + t, 0) / bestN.length;

  return { ok: true, paceMs, lapsUsed: bestN.length, n };
}

const UNCLEAN_KEYWORDS = [
  "pit",
  "off track",
  "off_track",
  "offtrack",
  "black flag",
  "black_flag",
  "contact",
  "invalid",
  "spin",
  "penalty",
  "disqualif",
  "repair",
  "tow",
];

/**
 * Best-effort lap classifier. iRacing's real lap_data flag values have not
 * been validated against a live payload in this environment (needs a
 * verified OAuth session) - see PRD §6/§10.5. This intentionally avoids
 * trusting a hardcoded third-party bitmask: it only calls a lap "clean"
 * when it finds a positive signal (decoded event names, or an explicit
 * incident/pit indicator), and returns isClean=null (unknown) rather than
 * assuming clean when no such signal is present. Recompute once real
 * payload shapes are confirmed.
 */
export function classifyLap(row: Record<string, unknown>): {
  isPitLap: boolean;
  isClean: boolean | null;
  flagsRaw: number | null;
  flagsDecoded: string[];
} {
  const flagsRaw = pickNumber(row.flags ?? row.lap_flags ?? row.lapFlags);

  const decodedRaw =
    row.lap_events ??
    row.lapEvents ??
    row.flags_decoded ??
    row.decoded_flags ??
    row.event_names;

  const flagsDecoded: string[] = Array.isArray(decodedRaw)
    ? decodedRaw.filter((v): v is string => typeof v === "string")
    : [];

  const incidentCount = pickNumber(row.incident ?? row.incident_count ?? row.incidents);

  const isPitLap = Boolean(
    row.lap_in_pits ??
      row.lapInPits ??
      row.pit_in ??
      row.pit_out ??
      row.pitted ??
      flagsDecoded.some((f) => f.toLowerCase().includes("pit"))
  );

  let isClean: boolean | null = null;

  if (flagsDecoded.length > 0) {
    const hasBadFlag = flagsDecoded.some((f) => {
      const lower = f.toLowerCase();
      return UNCLEAN_KEYWORDS.some((kw) => lower.includes(kw));
    });
    isClean = !hasBadFlag && !isPitLap;
  } else if (typeof incidentCount === "number") {
    isClean = incidentCount === 0 && !isPitLap;
  }
  // else: no usable signal at all - leave isClean = null (unknown), not "clean".

  return { isPitLap, isClean, flagsRaw: flagsRaw ?? null, flagsDecoded };
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
