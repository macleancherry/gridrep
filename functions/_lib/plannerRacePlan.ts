/**
 * Stint projection math (PRD §4 step 6): given an ordered list of stints (driver + lap
 * count + that driver's pace/fuel snapshot), compute each stint's duration, fuel load,
 * and running start/pit-target offsets, plus plan-wide totals (stops, seat time, fuel).
 * Pure function - no DB access - so it's cheap to recompute on every stint-list save.
 */

export type StintInput = {
  custId: string;
  lapCount: number;
  paceMs: number;
  fuelPerLap: number;
};

export type ComputedStint = StintInput & {
  order: number;
  startOffsetMinutes: number;
  durationMinutes: number;
  fuelLoadLiters: number;
  pitTargetOffsetMinutes: number;
  fuelWarning: boolean;
};

export type PlanTotals = {
  totalStops: number;
  totalFuelLiters: number;
  totalDurationMinutes: number;
  seatTimeMinutesByDriver: Record<string, number>;
  stintCountByDriver: Record<string, number>;
};

export function computeStintProjections(
  stints: StintInput[],
  opts: { pitStopSeconds: number; tankCapacityLiters: number | null }
): { stints: ComputedStint[]; totals: PlanTotals } {
  const pitStopMinutes = opts.pitStopSeconds / 60;
  const computed: ComputedStint[] = [];
  let cursorMinutes = 0;

  for (let i = 0; i < stints.length; i++) {
    const s = stints[i];
    const durationMinutes = (s.lapCount * s.paceMs) / 60000;
    const fuelLoadLiters = s.lapCount * s.fuelPerLap;
    const startOffsetMinutes = cursorMinutes;
    const endOffsetMinutes = startOffsetMinutes + durationMinutes;

    computed.push({
      ...s,
      order: i,
      startOffsetMinutes,
      durationMinutes,
      fuelLoadLiters,
      pitTargetOffsetMinutes: endOffsetMinutes,
      fuelWarning: opts.tankCapacityLiters !== null && fuelLoadLiters > opts.tankCapacityLiters,
    });

    // Next stint starts after this one's pit stop, except after the final stint
    // (the race just ends - no pit needed to "finish" the timeline).
    cursorMinutes = endOffsetMinutes + (i < stints.length - 1 ? pitStopMinutes : 0);
  }

  const seatTimeMinutesByDriver: Record<string, number> = {};
  const stintCountByDriver: Record<string, number> = {};
  let totalFuelLiters = 0;

  for (const s of computed) {
    seatTimeMinutesByDriver[s.custId] = (seatTimeMinutesByDriver[s.custId] ?? 0) + s.durationMinutes;
    stintCountByDriver[s.custId] = (stintCountByDriver[s.custId] ?? 0) + 1;
    totalFuelLiters += s.fuelLoadLiters;
  }

  return {
    stints: computed,
    totals: {
      totalStops: Math.max(0, computed.length - 1),
      totalFuelLiters,
      totalDurationMinutes: cursorMinutes,
      seatTimeMinutesByDriver,
      stintCountByDriver,
    },
  };
}
