/**
 * Clean-pace calculation for the race planner - ported from functions/_lib/cleanPace.ts
 * (Pace's proven implementation) as its own independent copy, per the PRD's "copy, don't
 * depend on Pace" decision (Pace is slated for removal). No network calls here, so pace
 * can be recomputed cheaply if N or the "clean lap" definition changes later.
 */

export type StoredLap = {
  lapTimeMs: number | null;
  isPitLap: boolean;
  isClean: boolean | null; // null = could not be classified from the stored payload
};

export type CleanPaceResult =
  | { ok: true; paceMs: number; lapsUsed: number; n: number; partial: boolean; lapTimesMs: number[] }
  | { ok: false; reason: "no_clean_laps"; n: number };

export function computeCleanPace(laps: StoredLap[], n = 5): CleanPaceResult {
  const cleanTimes = laps
    .filter((l) => l.isClean === true && !l.isPitLap && typeof l.lapTimeMs === "number" && l.lapTimeMs > 0)
    .map((l) => l.lapTimeMs as number)
    .sort((a, b) => a - b);

  if (cleanTimes.length === 0) {
    return { ok: false, reason: "no_clean_laps", n };
  }

  const bestN = cleanTimes.slice(0, Math.min(n, cleanTimes.length));
  const paceMs = bestN.reduce((sum, t) => sum + t, 0) / bestN.length;

  return { ok: true, paceMs, lapsUsed: bestN.length, n, partial: bestN.length < n, lapTimesMs: bestN };
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
 * Lap classifier. Confirmed live against real lap_data payloads (via Pace): every lap
 * row always carries a `lap_events` array (required field) - EMPTY for a genuinely clean
 * lap, populated with strings like "off track"/"invalid"/"pitted" otherwise. So an empty
 * array is itself the positive "clean" signal, not an absence of information - only a
 * *missing* lap_events field (a different endpoint shape/version) falls back to `incident`.
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

  const hasDecodedArray = Array.isArray(decodedRaw);
  const flagsDecoded: string[] = hasDecodedArray
    ? (decodedRaw as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const isPitLap = Boolean(
    row.lap_in_pits ??
      row.lapInPits ??
      row.pit_in ??
      row.pit_out ??
      row.pitted ??
      flagsDecoded.some((f) => f.toLowerCase().includes("pit"))
  );

  let isClean: boolean | null = null;

  if (hasDecodedArray) {
    const hasBadFlag = flagsDecoded.some((f) => {
      const lower = f.toLowerCase();
      return UNCLEAN_KEYWORDS.some((kw) => lower.includes(kw));
    });
    isClean = !hasBadFlag && !isPitLap;
  } else {
    const incidentRaw = row.incident ?? row.incident_count ?? row.incidents;
    const incidentCount = typeof incidentRaw === "boolean" ? (incidentRaw ? 1 : 0) : pickNumber(incidentRaw);
    if (typeof incidentCount === "number") {
      isClean = incidentCount === 0 && !isPitLap;
    }
    // else: no usable signal at all - leave isClean = null (unknown), not "clean".
  }

  return { isPitLap, isClean, flagsRaw: flagsRaw ?? null, flagsDecoded };
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
