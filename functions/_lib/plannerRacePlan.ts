import { isTeamCoordinator } from "./plannerTeams";

/**
 * Race-plan creation (PRD §7/§8) - extracted from functions/api/planner/race-plans.ts's
 * POST handler so the new series/session select-session flow can create a plan the same
 * way instead of duplicating the pit-rules-inheritance logic.
 */

export type CreateRacePlanOpts = {
  /** Optional/null when a car is created before it has a race picked yet (the coordinator
   *  navigation rebuild's "add a car, pick its race afterward" flow) - the plan's event_id
   *  stays NULL until a later select-session call attaches one. */
  eventId?: string | null;
  createdByUserId: string;
  custIds?: string[];
  name?: string;
  carName?: string | null;
  fuelTankCapacityLiters?: number | null;
  pitStopSeconds?: number | null;
  raceDurationMinutes?: number | null;
  /** Attaches the new plan to an existing Race Weekend (multi-car flow) instead of
   *  creating a fresh weekend-of-one-car for it. */
  raceWeekendId?: string | null;
  /** Only used when raceWeekendId isn't supplied - the weekend created for this new
   *  standalone plan belongs to this team (a coordinator planning for their roster)
   *  rather than being a solo driver's own weekend. */
  teamId?: string | null;
};

export class CreateRacePlanError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CreateRacePlanError";
    this.code = code;
  }
}

export async function createRacePlan(DB: any, opts: CreateRacePlanOpts): Promise<any> {
  let event: any = null;
  if (opts.eventId) {
    event = await DB.prepare(`SELECT id, name, duration_minutes as durationMinutes FROM iracing_events WHERE id = ?`)
      .bind(opts.eventId)
      .first<any>();
    if (!event) {
      throw new CreateRacePlanError("event_not_found", "Select this event before creating a plan.");
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = opts.name?.trim() || event?.name || "New car";
  const carName = opts.carName ?? null;
  const fuelTankCapacityLiters = opts.fuelTankCapacityLiters ?? null;
  const raceDurationMinutes = opts.raceDurationMinutes && opts.raceDurationMinutes > 0 ? opts.raceDurationMinutes : event?.durationMinutes ?? null;

  // Inherit the event's shared pit rules (§15.2) as the plan's default pit-stop time
  // unless the caller explicitly overrides it - a plan-level override is still just a
  // normal field from here on, per the PRD's "shared record is the default source of
  // truth, override stays possible" model. No event yet (a car created before its race is
  // picked) means no pit rules to inherit either - falls straight to the same 55s default.
  let pitStopSeconds = opts.pitStopSeconds && opts.pitStopSeconds > 0 ? opts.pitStopSeconds : null;
  if (pitStopSeconds === null) {
    const pitRules = opts.eventId
      ? await DB.prepare(
          `SELECT base_pit_time_seconds as basePitTimeSeconds, simultaneous_fuel_tyres as simultaneousFuelTyres,
                sequential_time_penalty_seconds as sequentialTimePenaltySeconds
         FROM event_pit_rules WHERE event_id = ?`
        )
          .bind(opts.eventId)
          .first<any>()
      : null;

    pitStopSeconds = pitRules
      ? pitRules.basePitTimeSeconds + (pitRules.simultaneousFuelTyres ? 0 : pitRules.sequentialTimePenaltySeconds)
      : 55;
  }

  // Every plan (Car Entry) belongs to exactly one Race Weekend. When the caller doesn't
  // hand one in (today's single-car flow, and every pre-multi-car call site), transparently
  // create a weekend-of-one-car wrapping just this plan - so a solo driver's existing
  // experience stays identical while the schema still gives the multi-car flow (PRD phase
  // 6) one consistent place to hang additional Car Entries off of later.
  let raceWeekendId = opts.raceWeekendId ?? null;
  if (!raceWeekendId) {
    raceWeekendId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO race_weekends (id, team_id, event_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(raceWeekendId, opts.teamId ?? null, opts.eventId ?? null, name, opts.createdByUserId, now)
      .run();
  }

  await DB.prepare(
    `INSERT INTO race_plans (id, event_id, race_weekend_id, name, car_name, fuel_tank_capacity_liters, pit_stop_seconds, race_duration_minutes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, opts.eventId ?? null, raceWeekendId, name, carName, fuelTankCapacityLiters, pitStopSeconds, raceDurationMinutes, opts.createdByUserId, now, now)
    .run();

  const custIds = opts.custIds ?? [];
  for (const custId of custIds) {
    await DB.prepare(`INSERT OR IGNORE INTO race_plan_lineup (race_plan_id, cust_id) VALUES (?, ?)`).bind(id, custId).run();
  }

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(id).first<any>();
  return { ...plan, custIds };
}

/**
 * Plan visibility (PRD access-control decision, plan report): a viewer may only see plans
 * they created, or plans where their own iRacing cust_id has been added to the lineup -
 * never another team's plan for the same shared event just by knowing its id.
 */
export async function listVisiblePlansForEvent(DB: any, eventId: string, viewer: { userId: string; iracingId: string }): Promise<any[]> {
  const rows = await DB.prepare(
    `SELECT DISTINCT p.id, p.event_id as eventId, p.name, p.car_name as carName,
            p.fuel_tank_capacity_liters as fuelTankCapacityLiters, p.pit_stop_seconds as pitStopSeconds,
            p.created_at as createdAt, p.updated_at as updatedAt
     FROM race_plans p
     LEFT JOIN race_plan_lineup l ON l.race_plan_id = p.id
     WHERE p.event_id = ? AND (p.created_by = ? OR l.cust_id = ?)
     ORDER BY p.updated_at DESC`
  )
    .bind(eventId, viewer.userId, viewer.iracingId)
    .all<any>();

  return rows.results ?? [];
}

/**
 * Every plan (Car Entry) the viewer can see, across every team and weekend - the "Plans"
 * and "Live" global list pages (coordinator navigation rebuild, 2026-07-22). Same
 * visibility rule as isPlanVisibleToTeam (creator, rostered driver, or active member of
 * the owning team), just without a single planId filter. `onlyLive` narrows to plans
 * currently linked to live tracking (live_subsession_id set via race-plans/[planId]/
 * live.ts) - "Live" is a real, coordinator-set link, not a time-window guess.
 */
export async function listVisiblePlansForViewer(
  DB: any,
  viewer: { userId: string; iracingId: string },
  opts: { onlyLive?: boolean } = {}
): Promise<any[]> {
  const rows = await DB.prepare(
    `SELECT DISTINCT p.id as planId, p.name, p.car_name as carName, p.live_subsession_id as liveSubsessionId,
            p.race_weekend_id as weekendId, w.name as weekendName, w.team_id as teamId, t.name as teamName,
            p.event_id as eventId, e.name as eventName, e.track_name as trackName, e.scheduled_start_time as scheduledStartTime
     FROM race_plans p
     LEFT JOIN race_weekends w ON w.id = p.race_weekend_id
     LEFT JOIN teams t ON t.id = w.team_id
     LEFT JOIN iracing_events e ON e.id = p.event_id
     LEFT JOIN race_plan_lineup l ON l.race_plan_id = p.id
     LEFT JOIN team_members m ON m.team_id = w.team_id AND m.status = 'active' AND (m.user_id = ? OR m.cust_id = ?)
     WHERE (p.created_by = ? OR l.cust_id = ? OR m.team_id IS NOT NULL)
       ${opts.onlyLive ? "AND p.live_subsession_id IS NOT NULL" : ""}
     ORDER BY e.scheduled_start_time DESC, p.updated_at DESC`
  )
    .bind(viewer.userId, viewer.iracingId, viewer.userId, viewer.iracingId)
    .all<any>();

  return rows.results ?? [];
}

export async function isPlanVisible(DB: any, planId: string, viewer: { userId: string; iracingId: string }): Promise<boolean> {
  const row = await DB.prepare(
    `SELECT 1
     FROM race_plans p
     LEFT JOIN race_plan_lineup l ON l.race_plan_id = p.id
     WHERE p.id = ? AND (p.created_by = ? OR l.cust_id = ?)
     LIMIT 1`
  )
    .bind(planId, viewer.userId, viewer.iracingId)
    .first();

  return Boolean(row);
}

/**
 * Wider than isPlanVisible on purpose: any active member of the team that owns this plan's
 * race weekend can see it, not only the plan's creator or someone already on this specific
 * car's lineup. Read paths only - a driver is meant to see and submit availability for a
 * team weekend as soon as they're on the roster, not only once a coordinator has already
 * added them to a car (availability is collected precisely to help decide who goes where,
 * PRD §13, feeding the multi-car distribution suggestion), and the same "team-visible by
 * default" call applies to just viewing a team plan/live status. Every *write* endpoint
 * (lineup/stints/duty-assignments/distribution edits) stays on the narrow isPlanVisible -
 * those aren't roster-wide by design, only visibility is.
 */
export async function isPlanVisibleToTeam(DB: any, planId: string, viewer: { userId: string; iracingId: string }): Promise<boolean> {
  if (await isPlanVisible(DB, planId, viewer)) return true;

  const row = await DB.prepare(
    `SELECT 1
     FROM race_plans p
     JOIN race_weekends w ON w.id = p.race_weekend_id
     JOIN team_members m ON m.team_id = w.team_id
     WHERE p.id = ? AND m.status = 'active' AND (m.user_id = ? OR m.cust_id = ?)
     LIMIT 1`
  )
    .bind(planId, viewer.userId, viewer.iracingId)
    .first();

  return Boolean(row);
}

/**
 * Who may delete a Car Entry (race plan): its own creator, or - for a team-owned weekend -
 * any coordinator of that team. Reused by the plan-delete endpoint and by the plan GET
 * response's `canDelete` flag so the frontend never has to re-derive coordinator status
 * itself.
 */
export async function canManagePlan(DB: any, planId: string, viewer: { userId: string; iracingId: string }): Promise<boolean> {
  const plan = await DB.prepare(`SELECT created_by as createdBy, race_weekend_id as weekendId FROM race_plans WHERE id = ?`)
    .bind(planId)
    .first<any>();
  if (!plan) return false;
  if (plan.createdBy === viewer.userId) return true;
  if (!plan.weekendId) return false;

  const weekend = await DB.prepare(`SELECT team_id as teamId FROM race_weekends WHERE id = ?`).bind(plan.weekendId).first<any>();
  if (!weekend?.teamId) return false;
  return isTeamCoordinator(DB, weekend.teamId, viewer.userId);
}

/**
 * Deletes one Car Entry and everything scoped to it (lineup/stints/duty assignments).
 * If that was the weekend's last remaining car, the now-empty weekend is cascaded away
 * too - the common single-car case wraps every plan in a weekend transparently
 * (createRacePlan above), so deleting "the plan" should mean deleting the whole thing from
 * the driver's point of view, not leaving an empty weekend behind for them to notice later.
 * A multi-car weekend with other cars still in it is left untouched.
 */
export async function cascadeDeleteRacePlan(DB: any, planId: string): Promise<{ weekendId: string | null; weekendDeleted: boolean; teamId: string | null }> {
  const plan = await DB.prepare(`SELECT race_weekend_id as weekendId FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  const weekendId: string | null = plan?.weekendId ?? null;

  await DB.batch([
    DB.prepare(`DELETE FROM race_plan_lineup WHERE race_plan_id = ?`).bind(planId),
    DB.prepare(`DELETE FROM race_plan_stints WHERE race_plan_id = ?`).bind(planId),
    DB.prepare(`DELETE FROM race_plan_duty_assignments WHERE race_plan_id = ?`).bind(planId),
    DB.prepare(`DELETE FROM driver_availability WHERE race_plan_id = ?`).bind(planId),
    DB.prepare(`DELETE FROM race_plans WHERE id = ?`).bind(planId),
  ]);

  let weekendDeleted = false;
  let teamId: string | null = null;
  if (weekendId) {
    const weekend = await DB.prepare(`SELECT team_id as teamId FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
    teamId = weekend?.teamId ?? null;

    const remaining = await DB.prepare(`SELECT COUNT(*) as n FROM race_plans WHERE race_weekend_id = ?`).bind(weekendId).first<any>();
    if ((remaining?.n ?? 0) === 0) {
      await DB.batch([
        DB.prepare(`DELETE FROM race_weekend_participants WHERE race_weekend_id = ?`).bind(weekendId),
        DB.prepare(`DELETE FROM race_weekends WHERE id = ?`).bind(weekendId),
      ]);
      weekendDeleted = true;
    }
  }

  return { weekendId, weekendDeleted, teamId };
}

/** Deletes a Race Weekend and every Car Entry in it (child-before-parent, same order as the
 *  single-plan cascade above and functions/api/account.ts's own per-team cascade). */
export async function cascadeDeleteRaceWeekend(DB: any, weekendId: string): Promise<void> {
  const planRows = await DB.prepare(`SELECT id FROM race_plans WHERE race_weekend_id = ?`).bind(weekendId).all<any>();
  const planIds: string[] = (planRows.results ?? []).map((r: any) => r.id);
  const planPh = planIds.length ? planIds.map(() => "?").join(",") : null;

  const statements: any[] = [];
  if (planPh) {
    statements.push(
      DB.prepare(`DELETE FROM race_plan_lineup WHERE race_plan_id IN (${planPh})`).bind(...planIds),
      DB.prepare(`DELETE FROM race_plan_stints WHERE race_plan_id IN (${planPh})`).bind(...planIds),
      DB.prepare(`DELETE FROM race_plan_duty_assignments WHERE race_plan_id IN (${planPh})`).bind(...planIds),
      DB.prepare(`DELETE FROM driver_availability WHERE race_plan_id IN (${planPh})`).bind(...planIds)
    );
  }
  statements.push(
    DB.prepare(`DELETE FROM race_plans WHERE race_weekend_id = ?`).bind(weekendId),
    DB.prepare(`DELETE FROM race_weekend_participants WHERE race_weekend_id = ?`).bind(weekendId),
    DB.prepare(`DELETE FROM race_weekends WHERE id = ?`).bind(weekendId)
  );

  await DB.batch(statements);
}

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

/**
 * Crew-role validation (PRD §14.3) - soft warnings only, never a reason to block a save.
 * Recomputed whenever the plan changes rather than stored, same as stint totals.
 */

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
  // Spotter coverage: every stint's [start, pit-target) driving window should be covered
  // by at least one spotting assignment - subtract the merged spotting intervals from
  // each stint's window and report whatever's left uncovered.
  const mergedSpotting = mergeIntervals(spotting.map((s) => ({ start: s.startOffsetMinutes, end: s.endOffsetMinutes })));
  const spotterGaps: SpotterGap[] = [];
  for (const s of stints) {
    const uncovered = subtractIntervals({ start: s.startOffsetMinutes, end: s.pitTargetOffsetMinutes }, mergedSpotting);
    for (const gap of uncovered) {
      if (gap.end - gap.start > 0.01) spotterGaps.push({ startOffsetMinutes: gap.start, endOffsetMinutes: gap.end });
    }
  }

  // Extended driving stretch: the only way a driver gets a break is another driver's
  // stint sitting between two of theirs - so walk the ordered stint list and merge
  // consecutive same-driver entries into one continuous run (a double stint's own pit
  // stop stays inside the run; the driver never left the car).
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
