import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";
import {
  computeStintProjections,
  computeDutyWarnings,
  isPlanVisibleToTeam,
  canManagePlan,
  cascadeDeleteRacePlan,
  type StintInput,
  type SpottingAssignment,
} from "../../../_lib/plannerRacePlan";
import { ensureDriverIds, displayDrivers } from "../../../_lib/driverIdentity";

/** Retrieve a plan for display/export (PRD §8) - stints + live-recomputed totals.
 * Visible to the plan's creator, a driver already in its lineup, or any other active
 * member of the team that owns its race weekend (never another team's plan for the same
 * shared event, just by knowing its id) - read-only team-wide visibility, same call as
 * availability (PRD §13.7.3); editing the lineup/stints themselves stays narrower. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to view this plan." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT * FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisibleToTeam(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const lineupRows = await DB.prepare(`SELECT cust_id as custId FROM race_plan_lineup WHERE race_plan_id = ?`).bind(planId).all<any>();

  // Quick-add source for the Lineup page (PRD phase 4: "search for a driver" repointed at
  // team rosters) - only present when this plan's race weekend actually belongs to a team;
  // a solo driver's own weekend (team_id NULL, the common case today) gets nothing extra
  // here, keeping that flow byte-identical to before this existed.
  let teamId: string | null = null;
  let rosterCustIds: string[] = [];
  if (plan.race_weekend_id) {
    const weekend = await DB.prepare(`SELECT team_id as teamId FROM race_weekends WHERE id = ?`).bind(plan.race_weekend_id).first<any>();
    teamId = weekend?.teamId ?? null;
    if (teamId) {
      // Every roster member is a valid quick-add, including ones who haven't personally
      // accepted their invite yet ('invited') - lineup membership only needs a real
      // cust_id (which a coordinator-added roster row always has), not a connected
      // gridrep account, same as adding a guest driver via the search box below already
      // works without them ever having signed in.
      const rosterRows = await DB.prepare(`SELECT cust_id as custId FROM team_members WHERE team_id = ?`).bind(teamId).all<any>();
      rosterCustIds = (rosterRows.results ?? []).map((r: any) => r.custId);
    }
  }

  const stintRows = await DB.prepare(
    `SELECT s.id, s.stint_order as stintOrder, s.cust_id as custId,
            s.lap_count as lapCount, s.pace_ms as paceMs, s.fuel_per_lap as fuelPerLap
     FROM race_plan_stints s WHERE s.race_plan_id = ? ORDER BY s.stint_order ASC`
  )
    .bind(planId)
    .all<any>();

  const stintInputs: StintInput[] = (stintRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    lapCount: r.lapCount,
    paceMs: r.paceMs,
    fuelPerLap: r.fuelPerLap,
  }));

  const { stints, totals } = computeStintProjections(stintInputs, {
    pitStopSeconds: plan.pit_stop_seconds,
    tankCapacityLiters: plan.fuel_tank_capacity_liters,
  });

  const spottingRows = await DB.prepare(
    `SELECT a.cust_id as custId, a.start_time_offset_minutes as startOffsetMinutes, a.end_time_offset_minutes as endOffsetMinutes
     FROM race_plan_duty_assignments a
     WHERE a.race_plan_id = ? AND a.role = 'spotting' ORDER BY a.start_time_offset_minutes ASC`
  )
    .bind(planId)
    .all<any>();

  const spottingAssignments: SpottingAssignment[] = (spottingRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    startOffsetMinutes: r.startOffsetMinutes,
    endOffsetMinutes: r.endOffsetMinutes,
  }));

  const warnings = computeDutyWarnings(stints, spottingAssignments, plan.fatigue_threshold_minutes ?? 120);

  const canDelete = await canManagePlan(DB, planId, viewerIdentity);

  // Every driver identity on this page (lineup, roster quick-add, stints, spotting)
  // resolved and consent-gated in one pass, rather than four separate raw `drivers`
  // joins - a driver without active consent appears with name: null everywhere here.
  const allCustIds = [
    ...(lineupRows.results ?? []).map((r: any) => r.custId),
    ...rosterCustIds,
    ...stintInputs.map((s) => s.custId),
    ...spottingAssignments.map((s) => s.custId),
  ];
  const driverIdByCustId = await ensureDriverIds(DB, allCustIds);
  const display = await displayDrivers(DB, [...driverIdByCustId.values()]);
  const nameFor = (custId: string) => display.get(driverIdByCustId.get(custId)!)?.name ?? null;

  return json({
    ok: true,
    plan,
    eventId: plan.event_id, // plan itself is a raw `SELECT *` row (snake_case) - this is the camelCase convenience field
    weekendId: plan.race_weekend_id,
    lineup: (lineupRows.results ?? []).map((r: any) => ({ driverId: driverIdByCustId.get(r.custId), driverName: nameFor(r.custId) })),
    teamId,
    teamRoster: rosterCustIds
      .map((custId) => ({ driverId: driverIdByCustId.get(custId), driverName: nameFor(custId) }))
      .sort((a, b) => (a.driverName ?? "").localeCompare(b.driverName ?? "")),
    stints: stints.map((s) => ({ ...s, driverId: driverIdByCustId.get(s.custId), driverName: nameFor(s.custId), custId: undefined })),
    totals,
    spotting: spottingAssignments.map((s) => ({
      driverId: driverIdByCustId.get(s.custId),
      driverName: nameFor(s.custId),
      startOffsetMinutes: s.startOffsetMinutes,
      endOffsetMinutes: s.endOffsetMinutes,
    })),
    warnings: {
      ...warnings,
      extendedStretches: warnings.extendedStretches.map((e) => ({
        driverId: driverIdByCustId.get(e.custId),
        driverName: nameFor(e.custId),
        startOffsetMinutes: e.startOffsetMinutes,
        endOffsetMinutes: e.endOffsetMinutes,
        durationMinutes: e.durationMinutes,
      })),
    },
    canDelete,
  });
}

/** Deletes this Car Entry (and, if it was its weekend's last remaining car, the now-empty
 *  weekend too - see cascadeDeleteRacePlan). Creator-or-team-coordinator only. */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to delete this plan." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await canManagePlan(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have permission to delete this plan." });
  }

  const { weekendId, weekendDeleted, teamId } = await cascadeDeleteRacePlan(DB, planId);

  return json({ ok: true, weekendId, weekendDeleted, teamId });
}
