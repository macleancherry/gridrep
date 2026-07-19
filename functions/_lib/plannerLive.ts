/**
 * Live plan-vs-actual deviation (PRD §12, vision step 7). Pure function - no DB/network -
 * so it's cheap to recompute on every poll and easy to verify against fixed inputs, same
 * pattern as computeStintProjections/computeDutyWarnings.
 *
 * FuelLevelPct's raw unit is unconfirmed from a real live session (no live iRacing session
 * available to capture in this sandbox - same class of "unit says %, but is it 0-1 or
 * 0-100" uncertainty already found and fixed once this session for precip_chance).
 * Normalized defensively here rather than assumed: a value <= 1 is treated as a 0-1
 * fraction and scaled up, anything larger is assumed already a 0-100 percent.
 */

export type LiveRow = {
  customerId: number;
  driverName: string;
  position: number;
  lap: number;
  lastLap: number | null; // seconds
  bestLap: number | null; // seconds
  gap: number | null; // seconds
  inPits: boolean | null;
  fuelLevelPct: number | null; // raw, unnormalized
  updatedAt: string;
};

export type PlannedStint = {
  order: number;
  custId: string;
  lapCount: number;
  paceMs: number;
  fuelLoadLiters: number;
  fuelPerLap: number;
};

export type LiveDeviation =
  | { ok: false; reason: "no_stints" | "no_live_data_for_lineup" }
  | {
      ok: true;
      currentDriverCustId: string;
      currentDriverName: string;
      currentLap: number;
      position: number;
      gapSeconds: number | null;
      inPits: boolean;
      lastUpdatedAt: string;
      expectedStintOrder: number | null;
      expectedCustId: string | null;
      driverMismatch: boolean;
      beyondPlannedDistance: boolean;
      actualPaceSeconds: number | null;
      expectedPaceSeconds: number | null;
      paceDeltaPct: number | null;
      paceWarning: boolean;
      actualFuelPct: number | null;
      expectedFuelPct: number | null;
      fuelDeltaPct: number | null;
      fuelWarning: boolean;
      lapsUntilPlannedPit: number | null;
    };

const PACE_WARNING_THRESHOLD = 0.03; // ±3% off planned pace
const FUEL_WARNING_THRESHOLD_PTS = 8; // actual this many points below expected

function normalizeFuelPct(raw: number | null): number | null {
  if (raw === null) return null;
  return raw <= 1 ? raw * 100 : raw;
}

export function computeLiveDeviation(stints: PlannedStint[], lineupCustIds: string[], liveRows: LiveRow[], tankCapacityLiters: number | null): LiveDeviation {
  if (stints.length === 0) return { ok: false, reason: "no_stints" };

  const matched = liveRows.filter((r) => lineupCustIds.includes(String(r.customerId)));
  if (matched.length === 0) return { ok: false, reason: "no_live_data_for_lineup" };

  const current = matched.reduce((latest, r) => (Date.parse(r.updatedAt) > Date.parse(latest.updatedAt) ? r : latest));
  const currentLap = current.lap;

  let sumLapsBefore = 0;
  let expected: PlannedStint | null = null;
  for (const s of stints) {
    if (currentLap < sumLapsBefore + s.lapCount) {
      expected = s;
      break;
    }
    sumLapsBefore += s.lapCount;
  }
  const beyondPlannedDistance = expected === null;
  if (!expected) {
    expected = stints[stints.length - 1];
    sumLapsBefore -= expected.lapCount; // walk back to this stint's own start boundary
  }

  const driverMismatch = String(current.customerId) !== expected.custId;

  const actualPaceSeconds = current.lastLap ?? current.bestLap ?? null;
  const expectedPaceSeconds = expected.paceMs / 1000;
  const paceDeltaPct = actualPaceSeconds !== null ? (actualPaceSeconds - expectedPaceSeconds) / expectedPaceSeconds : null;
  const paceWarning = paceDeltaPct !== null && Math.abs(paceDeltaPct) > PACE_WARNING_THRESHOLD;

  const actualFuelPct = normalizeFuelPct(current.fuelLevelPct);
  let expectedFuelPct: number | null = null;
  if (tankCapacityLiters !== null && tankCapacityLiters > 0) {
    const lapsIntoStint = Math.max(0, currentLap - sumLapsBefore);
    const fuelConsumed = lapsIntoStint * expected.fuelPerLap;
    const fuelRemaining = expected.fuelLoadLiters - fuelConsumed;
    expectedFuelPct = Math.max(0, Math.min(100, (fuelRemaining / tankCapacityLiters) * 100));
  }
  const fuelDeltaPct = actualFuelPct !== null && expectedFuelPct !== null ? actualFuelPct - expectedFuelPct : null;
  const fuelWarning = fuelDeltaPct !== null && fuelDeltaPct < -FUEL_WARNING_THRESHOLD_PTS;

  return {
    ok: true,
    currentDriverCustId: String(current.customerId),
    currentDriverName: current.driverName,
    currentLap,
    position: current.position,
    gapSeconds: current.gap,
    inPits: Boolean(current.inPits),
    lastUpdatedAt: current.updatedAt,
    expectedStintOrder: expected.order,
    expectedCustId: expected.custId,
    driverMismatch,
    beyondPlannedDistance,
    actualPaceSeconds,
    expectedPaceSeconds,
    paceDeltaPct,
    paceWarning,
    actualFuelPct,
    expectedFuelPct,
    fuelDeltaPct,
    fuelWarning,
    lapsUntilPlannedPit: beyondPlannedDistance ? null : sumLapsBefore + expected.lapCount - currentLap,
  };
}
