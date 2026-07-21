/**
 * Client-side port of functions/_lib/plannerRacePlan.ts's computeStintProjections and
 * computeDutyWarnings - pure, dependency-free math, kept identical to the backend copy so
 * StintsPage.tsx can preview a driver swap/reorder/add/remove instantly, without a network
 * round-trip. Preview only: "Save stint plan" still round-trips through the real backend
 * (functions/api/planner/race-plans/[planId]/stints.ts), which remains authoritative and
 * overwrites whatever was previewed here with its own recomputed result.
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

export type SpottingAssignment = { custId: string; startOffsetMinutes: number; endOffsetMinutes: number };

export type SpotterGap = { startOffsetMinutes: number; endOffsetMinutes: number };
export type ExtendedStretch = { custId: string; startOffsetMinutes: number; endOffsetMinutes: number; durationMinutes: number };

type Interval = { start: number; end: number };

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

function subtractIntervals(base: Interval, subtract: Interval[]): Interval[] {
  let remaining = [base];
  for (const sub of subtract) {
    const next: Interval[] = [];
    for (const r of remaining) {
      if (sub.end <= r.start || sub.start >= r.end) {
        next.push(r);
        continue;
      }
      if (sub.start > r.start) next.push({ start: r.start, end: sub.start });
      if (sub.end < r.end) next.push({ start: sub.end, end: r.end });
    }
    remaining = next;
  }
  return remaining;
}

export function computeDutyWarnings(
  stints: ComputedStint[],
  spotting: SpottingAssignment[],
  fatigueThresholdMinutes: number
): { spotterGaps: SpotterGap[]; extendedStretches: ExtendedStretch[] } {
  const mergedSpotting = mergeIntervals(spotting.map((s) => ({ start: s.startOffsetMinutes, end: s.endOffsetMinutes })));
  const spotterGaps: SpotterGap[] = [];
  for (const s of stints) {
    const uncovered = subtractIntervals({ start: s.startOffsetMinutes, end: s.pitTargetOffsetMinutes }, mergedSpotting);
    for (const gap of uncovered) {
      if (gap.end - gap.start > 0.01) spotterGaps.push({ startOffsetMinutes: gap.start, endOffsetMinutes: gap.end });
    }
  }

  const extendedStretches: ExtendedStretch[] = [];
  let run: { custId: string; start: number; end: number } | null = null;

  const flushRun = () => {
    if (run && run.end - run.start > fatigueThresholdMinutes) {
      extendedStretches.push({ custId: run.custId, startOffsetMinutes: run.start, endOffsetMinutes: run.end, durationMinutes: run.end - run.start });
    }
  };

  for (const s of stints) {
    if (run && run.custId === s.custId) {
      run.end = s.pitTargetOffsetMinutes;
    } else {
      flushRun();
      run = { custId: s.custId, start: s.startOffsetMinutes, end: s.pitTargetOffsetMinutes };
    }
  }
  flushRun();

  return { spotterGaps, extendedStretches };
}
