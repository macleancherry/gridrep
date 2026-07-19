import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";
import { buildAvailabilityBlocks, type ConditionWindow, type AvailabilityBlock } from "../../../../_lib/plannerAvailability";
import { computeStintProjections, computeDutyWarnings, isPlanVisible, type StintInput, type SpottingAssignment } from "../../../../_lib/plannerRacePlan";

type Pref = "prefer" | "neutral" | "avoid";

type Candidate = {
  custId: string;
  driverName: string;
  paceMs: number;
  fuelPerLap: number;
  maxLaps: number;
  nightPreference: Pref;
  wetPreference: Pref;
  startPreference: Pref;
};

function blockForOffset(blocks: AvailabilityBlock[], offsetMinutes: number): AvailabilityBlock | null {
  for (const b of blocks) {
    if (offsetMinutes >= b.blockStartOffsetMinutes && offsetMinutes < b.blockEndOffsetMinutes) return b;
  }
  return blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

/**
 * Auto-generate a proposed stint order (PRD §4 step 6 / vision step 5) - a starting
 * suggestion the driver can then drag/edit/remove on the Stints page, not a final,
 * auto-saved plan. Never writes to race_plan_stints itself; reuses the same
 * computeStintProjections/computeDutyWarnings the manual save path already relies on so
 * "generated" and "hand-built" plans are judged by identical math.
 *
 * Greedy timeline walk: at each point, pick the eligible driver (has a computed pace/fuel
 * profile) whose standing night/wet/race-start preference best matches this block's
 * conditions, breaking ties by whoever has driven the fewest stints so far (fairness),
 * then by raw pace. A driver is never picked back-to-back when an alternative exists, so
 * the fatigue-stretch warning the manual flow already surfaces doesn't fire by
 * construction (except in the single-eligible-driver case, which is genuinely
 * unavoidable and called out in the response).
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to generate a stint plan." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(
    `SELECT p.id, p.event_id as eventId, p.pit_stop_seconds as pitStopSeconds, p.fuel_tank_capacity_liters as fuelTankCapacityLiters,
            p.fatigue_threshold_minutes as fatigueThresholdMinutes, p.race_duration_minutes as raceDurationMinutes,
            p.time_slot_id as timeSlotId, p.availability_block_minutes as blockMinutes,
            e.track_name as trackName, e.scheduled_start_time as eventStartUtc, e.duration_minutes as eventDurationMinutes
     FROM race_plans p JOIN iracing_events e ON e.id = p.event_id
     WHERE p.id = ?`
  )
    .bind(planId)
    .first<any>();

  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const raceDurationMinutes = plan.raceDurationMinutes ?? plan.eventDurationMinutes ?? null;
  if (!raceDurationMinutes || raceDurationMinutes <= 0) {
    return jsonError(400, { error: "no_duration", message: "This plan has no race duration set yet." });
  }

  const body = await context.request.json().catch(() => ({}));
  const conditionProfileId: string | null = typeof body?.conditionProfileId === "string" && body.conditionProfileId ? body.conditionProfileId : null;

  const lineupRows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName FROM race_plan_lineup l LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id WHERE l.race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();
  const lineup: { custId: string; driverName: string }[] = lineupRows.results ?? [];
  if (lineup.length === 0) {
    return jsonError(400, { error: "no_lineup", message: "Add drivers to the lineup before generating a stint plan." });
  }

  if (!plan.trackName) {
    return jsonError(400, { error: "no_track", message: "This event has no track set yet, so no driver profiles can be found." });
  }

  const notes: string[] = [];
  const fatigueThresholdMinutes = plan.fatigueThresholdMinutes ?? 120;
  const tankCapacityLiters: number | null = plan.fuelTankCapacityLiters ?? null;

  const candidates: Candidate[] = [];
  for (const driver of lineup) {
    const rowId = `${driver.custId}:${plan.trackName}:${conditionProfileId ?? "none"}`;
    const profile = await DB.prepare(`SELECT pace_ms as paceMs, fuel_per_lap as fuelPerLap FROM driver_track_profiles WHERE id = ?`)
      .bind(rowId)
      .first<any>();
    if (!profile?.paceMs || !profile?.fuelPerLap) continue;

    const prefRow = await DB.prepare(
      `SELECT p.night_preference as nightPreference, p.wet_preference as wetPreference, p.start_preference as startPreference
       FROM users u JOIN driver_condition_preferences p ON p.user_id = u.id
       WHERE u.iracing_member_id = ?`
    )
      .bind(driver.custId)
      .first<any>();

    const lapMinutes = profile.paceMs / 60000;
    const maxLapsByFuel = tankCapacityLiters !== null ? Math.max(1, Math.floor(tankCapacityLiters / profile.fuelPerLap)) : Infinity;
    const maxLapsByFatigue = Math.max(1, Math.floor(fatigueThresholdMinutes / lapMinutes));

    candidates.push({
      custId: driver.custId,
      driverName: driver.driverName ?? `Driver ${driver.custId}`,
      paceMs: profile.paceMs,
      fuelPerLap: profile.fuelPerLap,
      maxLaps: Math.min(maxLapsByFuel, maxLapsByFatigue),
      nightPreference: prefRow?.nightPreference ?? "neutral",
      wetPreference: prefRow?.wetPreference ?? "neutral",
      startPreference: prefRow?.startPreference ?? "neutral",
    });
  }

  if (candidates.length === 0) {
    return jsonError(400, {
      error: "no_profiles",
      message: "No lineup driver has a computed pace/fuel profile yet. Compute profiles on the Lineup page first.",
    });
  }
  if (candidates.length === 1) {
    notes.push(`Only ${candidates[0].driverName} has a computed profile - every stint goes to them, so the fatigue warning below is expected.`);
  }

  // Availability + condition-window lookups, both optional signals - missing data never
  // blocks generation, it just falls back to "assume available" / "no preference."
  const availRows = await DB.prepare(
    `SELECT cust_id as custId, block_start_offset_minutes as blockStartOffsetMinutes, status FROM driver_availability WHERE race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();
  const availabilityByKey = new Map<string, string>();
  for (const r of availRows.results ?? []) {
    availabilityByKey.set(`${r.custId}:${r.blockStartOffsetMinutes}`, r.status);
  }

  let startUtcIso: string | null = plan.eventStartUtc;
  if (plan.timeSlotId) {
    const slot = await DB.prepare(`SELECT start_datetime_utc as startDatetimeUtc FROM race_plan_time_slots WHERE id = ?`).bind(plan.timeSlotId).first<any>();
    if (slot) startUtcIso = slot.startDatetimeUtc;
  }

  let availabilityBlocks: AvailabilityBlock[] = [];
  if (startUtcIso) {
    const conditionRows = await DB.prepare(
      `SELECT label, window_offset_start_minutes as windowStartMin, window_offset_end_minutes as windowEndMin,
              expected_track_temp_min as trackTempMin, expected_track_temp_max as trackTempMax,
              expected_air_temp_min as airTempMin, expected_air_temp_max as airTempMax, expected_track_state as trackState
       FROM event_condition_profiles WHERE event_id = ?`
    )
      .bind(plan.eventId)
      .all<any>();

    availabilityBlocks = buildAvailabilityBlocks({
      startUtcIso,
      durationMinutes: raceDurationMinutes,
      blockMinutes: plan.blockMinutes ?? 60,
      timeZone: "UTC",
      conditionProfiles: (conditionRows.results ?? []) as ConditionWindow[],
    });
  } else {
    notes.push("This plan has no scheduled start time yet, so night/wet condition matching was skipped.");
  }

  function prefScore(pref: Pref): number {
    return pref === "prefer" ? 2 : pref === "avoid" ? -2 : 0;
  }

  const stintInputs: StintInput[] = [];
  const stintCountByCustId: Record<string, number> = {};
  let cursorMinutes = 0;
  let lastCustId: string | null = null;
  let fellBackOnAvailability = false;
  const MAX_STINTS = 300;

  while (cursorMinutes < raceDurationMinutes && stintInputs.length < MAX_STINTS) {
    const block = availabilityBlocks.length > 0 ? blockForOffset(availabilityBlocks, cursorMinutes) : null;
    const isNight = block?.condition?.label === "Night";
    const isWet = block?.condition?.trackState === "wet";
    const isRaceStart = cursorMinutes === 0;

    let pool = candidates.filter((c) => c.custId !== lastCustId || candidates.length === 1);

    if (block) {
      const availablePool = pool.filter((c) => {
        const status = availabilityByKey.get(`${c.custId}:${block.blockStartOffsetMinutes}`);
        return status !== "unavailable";
      });
      if (availablePool.length > 0) {
        pool = availablePool;
      } else if (availRows.results && availRows.results.length > 0) {
        fellBackOnAvailability = true;
      }
    }

    let best = pool[0];
    let bestScore = -Infinity;
    for (const c of pool) {
      let score = 0;
      if (isNight) score += prefScore(c.nightPreference);
      if (isWet) score += prefScore(c.wetPreference);
      if (isRaceStart) score += prefScore(c.startPreference);
      score -= (stintCountByCustId[c.custId] ?? 0) * 1.5; // fairness: spread stints around
      score -= c.paceMs / 1_000_000; // tie-break toward raw pace, negligible weight otherwise
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    const remainingMinutes = raceDurationMinutes - cursorMinutes;
    const lapMinutes = best.paceMs / 60000;
    const lapsNeededForRemaining = Math.max(1, Math.ceil(remainingMinutes / lapMinutes));
    const lapCount = Math.max(1, Math.min(best.maxLaps, lapsNeededForRemaining));

    stintInputs.push({ custId: best.custId, lapCount, paceMs: best.paceMs, fuelPerLap: best.fuelPerLap });
    stintCountByCustId[best.custId] = (stintCountByCustId[best.custId] ?? 0) + 1;

    const pitStopMinutes = plan.pitStopSeconds / 60;
    cursorMinutes += lapCount * lapMinutes + pitStopMinutes;
    lastCustId = best.custId;
  }

  if (fellBackOnAvailability) {
    notes.push("Some blocks had no driver marked available - assigned regardless so the suggestion stays complete; review before saving.");
  }
  if (stintInputs.length >= MAX_STINTS) {
    notes.push("Stopped after 300 stints as a safety limit - check the plan's race duration and pit-stop time.");
  }

  const { stints, totals } = computeStintProjections(stintInputs, {
    pitStopSeconds: plan.pitStopSeconds,
    tankCapacityLiters,
  });

  const spottingRows = await DB.prepare(
    `SELECT cust_id as custId, start_time_offset_minutes as startOffsetMinutes, end_time_offset_minutes as endOffsetMinutes
     FROM race_plan_duty_assignments WHERE race_plan_id = ? AND role = 'spotting'`
  )
    .bind(planId)
    .all<any>();
  const spottingAssignments: SpottingAssignment[] = (spottingRows.results ?? []).map((r: any) => ({
    custId: r.custId,
    startOffsetMinutes: r.startOffsetMinutes,
    endOffsetMinutes: r.endOffsetMinutes,
  }));

  const warnings = computeDutyWarnings(stints, spottingAssignments, fatigueThresholdMinutes);

  const driverNameByCustId = new Map(candidates.map((c) => [c.custId, c.driverName]));

  return json({
    ok: true,
    planId,
    stints: stints.map((s) => ({ ...s, driverName: driverNameByCustId.get(s.custId) ?? `Driver ${s.custId}` })),
    totals,
    warnings,
    notes,
  });
}
