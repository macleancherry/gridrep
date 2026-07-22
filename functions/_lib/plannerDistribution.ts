/**
 * Multi-car driver distribution (PRD phase 6): given a race weekend's participant pool,
 * each driver's availability unioned across every car sharing this race (driver_availability
 * is scoped per Car Entry since the coordinator navigation rebuild, 2026-07-22 - this
 * suggestion is only ever surfaced when 2+ cars in a weekend share the exact same event,
 * see RaceWeekendPage.tsx), and a set of Car Entries, propose a balanced split of drivers
 * across cars.
 *
 * Deliberately scoped: this is a suggestion the coordinator reviews and edits before
 * confirming (PRD decision - "suggest, coordinator confirms," never fully automatic),
 * not an attempt at optimal stint-level scheduling. Every car this suggestion runs over
 * shares the same green-flag time by construction, so "never double-booking a driver into
 * two cars at overlapping real-world times" collapses to a much simpler constraint than a
 * general interval-scheduling problem: each driver is simply assigned to at most one car.
 *
 * Algorithm: classic greedy load-balancing (longest-processing-time-first bin packing).
 * Each driver's "load" is their total available minutes across the weekend (available
 * blocks full weight, maybe blocks half weight, unavailable zero) - drivers are assigned,
 * highest-load first, to whichever car currently has the lowest running total. This is a
 * well-understood heuristic with a known worst-case bound (never more than 4/3x the
 * optimal max-car-load), not a novel or unproven scheme.
 *
 * Explicitly NOT attempted here (real limitations, not hidden): per-block coverage
 * (guaranteeing every block of the race has an available driver in each car - a much
 * harder combinatorial problem) and condition-preference balancing (night/wet/start
 * spread across cars) - both left to the coordinator's own judgment when reviewing the
 * draft, using data already surfaced elsewhere (Availability page's preference badges).
 */

export type WeekendAvailabilityBlock = { custId: string; status: "available" | "maybe" | "unavailable" };

export type CarEntry = { carId: string; name: string };

export type DistributionAssignment = {
  carId: string;
  custId: string;
  driverName: string | null;
  availableMinutes: number;
};

export type DistributionResult = {
  assignments: DistributionAssignment[];
  carTotals: Record<string, number>;
  unassignedCustIds: string[];
};

function computeAvailableMinutes(blocks: WeekendAvailabilityBlock[], blockMinutes: number): number {
  let total = 0;
  for (const b of blocks) {
    if (b.status === "available") total += blockMinutes;
    else if (b.status === "maybe") total += blockMinutes * 0.5;
  }
  return total;
}

export function suggestDistribution(
  participants: { custId: string; driverName: string | null }[],
  availabilityByCustId: Map<string, WeekendAvailabilityBlock[]>,
  cars: CarEntry[],
  blockMinutes: number
): DistributionResult {
  if (cars.length === 0) {
    return { assignments: [], carTotals: {}, unassignedCustIds: participants.map((p) => p.custId) };
  }

  const loaded = participants
    .map((p) => ({
      ...p,
      availableMinutes: computeAvailableMinutes(availabilityByCustId.get(p.custId) ?? [], blockMinutes),
    }))
    .sort((a, b) => b.availableMinutes - a.availableMinutes);

  const carTotals: Record<string, number> = {};
  for (const car of cars) carTotals[car.carId] = 0;

  const assignments: DistributionAssignment[] = [];
  for (const driver of loaded) {
    // Lowest-loaded car so far gets the next driver - the core load-balancing step.
    let targetCarId = cars[0].carId;
    for (const car of cars) {
      if (carTotals[car.carId] < carTotals[targetCarId]) targetCarId = car.carId;
    }
    assignments.push({ carId: targetCarId, custId: driver.custId, driverName: driver.driverName, availableMinutes: driver.availableMinutes });
    carTotals[targetCarId] += driver.availableMinutes;
  }

  return { assignments, carTotals, unassignedCustIds: [] };
}
