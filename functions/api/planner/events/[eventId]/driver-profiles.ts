import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { computeAndStoreOneDriverProfile, driverProfileRowId } from "../../../../_lib/plannerDriverProfile";
import { getCachedCarCatalog, carIdsInSameClass } from "../../../../_lib/plannerIracing";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Driver track/condition/car profile computation (PRD §4 steps 4-5, §6, §7). Reads
 * whatever laps have already been synced into planner_iracing_laps/subsessions for this
 * track (via /api/planner/iracing/subsessions/:id/sync) - this endpoint doesn't itself
 * discover or pull new iRacing data, it computes over what's already stored, same
 * separation Pace's own /pace endpoint keeps between ingest and compute.
 *
 * Fuel-per-lap prefers real Garage 61 data (plannerGarage61Fuel.ts) when a confident match
 * is available, falling back to manual entry (PRD §5.2/§5.4's required fallback) otherwise.
 * Pace has the same manual fallback for a driver with no synced clean laps at this track -
 * with neither, Stints' pace+fuel readiness gate could never open for them. Either field's
 * own explicit manual entry always wins and is never silently overwritten by a later
 * automated recompute.
 *
 * When the caller passes planId, pace/fuel become scoped to that plan's selected car
 * (race_plans.car_id) - pace falls back to any other car sharing the event's real racing
 * class when the exact car has no data yet (plannerDriverProfile.ts), fuel requires an
 * exact match. GET additionally overlays that plan's own per-driver lock
 * (race_plan_lineup.locked_*, scoped to this one race only - never the shared cache) and
 * race-wide default pace/fuel (race_plans.default_*, used only for a driver who has
 * neither a lock nor their own real data yet).
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to compute driver profiles." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT id, track_name as trackName, track_config as trackConfig FROM iracing_events WHERE id = ?`)
    .bind(eventId)
    .first<any>();
  if (!event) {
    return jsonError(404, { error: "event_not_found", message: "Select this event before computing driver profiles." });
  }
  if (!event.trackName) {
    return jsonError(400, { error: "no_track", message: "This event has no track set yet." });
  }

  const body = await context.request.json().catch(() => null);
  const custIds: string[] = Array.isArray(body?.custIds) ? body.custIds.map(String).filter(Boolean) : [];
  if (custIds.length === 0) {
    return jsonError(400, { error: "invalid_cust_ids", message: "custIds (array) is required." });
  }
  const conditionProfileId: string | null = typeof body?.conditionProfileId === "string" ? body.conditionProfileId : null;
  const fuelOverrides: Record<string, number> = body?.fuelOverrides && typeof body.fuelOverrides === "object" ? body.fuelOverrides : {};
  const paceOverridesMs: Record<string, number> = body?.paceOverrides && typeof body.paceOverrides === "object" ? body.paceOverrides : {};

  // Optional: the gridrep team this plan belongs to, if any - lets the Garage 61 fuel
  // fallback (plannerGarage61Fuel.ts) scope its lap search to that team's own Garage 61
  // team (when one was ever linked via "Import roster from Garage 61") instead of every
  // Garage 61 team the connecting coordinator happens to belong to.
  const requestTeamId: string | null = typeof body?.teamId === "string" ? body.teamId : null;
  let garage61TeamSlug: string | null = null;
  if (requestTeamId) {
    const teamRow = await DB.prepare(`SELECT garage61_team_slug as slug FROM teams WHERE id = ?`).bind(requestTeamId).first<any>();
    garage61TeamSlug = teamRow?.slug ?? null;
  }

  // Optional: this plan's selected car - once set, pace/fuel become car-scoped (see file
  // header). A plan with no car chosen yet (or no planId passed at all) stays unscoped by
  // car, byte-identical to before this feature existed.
  const requestPlanId: string | null = typeof body?.planId === "string" ? body.planId : null;
  let carId: number | null = null;
  let carClassCarIds: number[] | null = null;
  if (requestPlanId) {
    const planRow = await DB.prepare(`SELECT car_id as carId, car_class_id as carClassId FROM race_plans WHERE id = ?`)
      .bind(requestPlanId)
      .first<any>();
    carId = planRow?.carId ?? null;
    if (carId !== null && planRow?.carClassId !== null && planRow?.carClassId !== undefined) {
      try {
        const accessToken = await getValidAccessToken(context, viewer.user!.id);
        const { catalog } = await getCachedCarCatalog(DB, accessToken);
        carClassCarIds = carIdsInSameClass(catalog, planRow.carClassId).filter((id) => id !== carId);
      } catch {
        carClassCarIds = null; // best-effort - the pace fallback just won't widen this time
      }
    }
  }

  let tempMid: number | null = null;
  if (conditionProfileId) {
    const profile = await DB.prepare(
      `SELECT expected_track_temp_min as trackTempMin, expected_track_temp_max as trackTempMax
       FROM event_condition_profiles WHERE id = ? AND event_id = ?`
    )
      .bind(conditionProfileId, eventId)
      .first<any>();

    if (!profile) {
      return jsonError(404, { error: "condition_profile_not_found", message: "Condition profile not found for this event." });
    }

    if (profile.trackTempMin !== null && profile.trackTempMax !== null) {
      tempMid = (profile.trackTempMin + profile.trackTempMax) / 2;
    } else {
      tempMid = profile.trackTempMin ?? profile.trackTempMax ?? null;
    }
  }

  const results: any[] = [];

  for (const custId of custIds) {
    const overrideFuel = fuelOverrides[custId];
    const overridePaceMs = paceOverridesMs[custId];
    const result = await computeAndStoreOneDriverProfile(context, DB, {
      custId,
      trackName: event.trackName,
      trackConfig: event.trackConfig ?? null,
      carId,
      carClassCarIds,
      conditionProfileId,
      tempMid,
      garage61TeamSlug,
      fuelOverride: typeof overrideFuel === "number" && Number.isFinite(overrideFuel) ? overrideFuel : undefined,
      paceOverrideMs: typeof overridePaceMs === "number" && Number.isFinite(overridePaceMs) ? overridePaceMs : undefined,
    });
    results.push(result);
  }

  return json({ ok: true, eventId, profiles: results });
}

export async function onRequestGet(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const custIdsParam = url.searchParams.get("custIds");
  const conditionProfileId = url.searchParams.get("conditionProfileId");
  const planId = url.searchParams.get("planId");

  const event = await DB.prepare(`SELECT track_name as trackName FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event?.trackName) {
    return json({ ok: true, eventId, profiles: [] });
  }

  const custIds = custIdsParam ? custIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (custIds.length === 0) {
    return json({ ok: true, eventId, profiles: [] });
  }

  let carId: number | null = null;
  let defaultPaceMs: number | null = null;
  let defaultFuelPerLap: number | null = null;
  let locksByCustId = new Map<string, { lockedPaceMs: number | null; lockedFuelPerLap: number | null; lockedAt: string | null }>();

  if (planId) {
    const planRow = await DB.prepare(
      `SELECT car_id as carId, default_pace_ms as defaultPaceMs, default_fuel_per_lap as defaultFuelPerLap FROM race_plans WHERE id = ?`
    )
      .bind(planId)
      .first<any>();
    carId = planRow?.carId ?? null;
    defaultPaceMs = planRow?.defaultPaceMs ?? null;
    defaultFuelPerLap = planRow?.defaultFuelPerLap ?? null;

    const placeholders = custIds.map(() => "?").join(",");
    const lockRows = await DB.prepare(
      `SELECT cust_id as custId, locked_pace_ms as lockedPaceMs, locked_fuel_per_lap as lockedFuelPerLap, locked_at as lockedAt
       FROM race_plan_lineup WHERE race_plan_id = ? AND cust_id IN (${placeholders})`
    )
      .bind(planId, ...custIds)
      .all<any>();
    locksByCustId = new Map((lockRows.results ?? []).map((r: any) => [r.custId, r]));
  }

  const ids = custIds.map((custId) => driverProfileRowId(custId, event.trackName, carId, conditionProfileId));
  const placeholders = ids.map(() => "?").join(",");

  const rows = await DB.prepare(
    `SELECT p.cust_id as custId, d.display_name as driverName, p.track_name as trackName,
            p.condition_profile_id as conditionProfileId, p.pace_ms as paceMs, p.pace_source as paceSource,
            p.laps_used as lapsUsed, p.sample_size as sampleSize, p.widened_band as widenedBand,
            p.fuel_per_lap as fuelPerLap, p.fuel_source as fuelSource, p.pit_time_seconds as pitTimeSeconds,
            p.pit_time_source as pitTimeSource, p.computed_at as computedAt
     FROM driver_track_profiles p
     LEFT JOIN drivers d ON d.iracing_member_id = p.cust_id
     WHERE p.id IN (${placeholders})`
  )
    .bind(...ids)
    .all<any>();

  const rowsByCustId = new Map((rows.results ?? []).map((r: any) => [r.custId, r]));

  const hasAnyOverlay = locksByCustId.size > 0 || defaultPaceMs !== null || defaultFuelPerLap !== null;
  let driverNameMap = new Map<string, string>();
  if (hasAnyOverlay) {
    const needsName = custIds.filter((id) => !rowsByCustId.has(id) && (locksByCustId.get(id)?.lockedAt || defaultPaceMs !== null || defaultFuelPerLap !== null));
    if (needsName.length > 0) {
      const namePlaceholders = needsName.map(() => "?").join(",");
      const nameRows = await DB.prepare(`SELECT iracing_member_id as custId, display_name as driverName FROM drivers WHERE iracing_member_id IN (${namePlaceholders})`)
        .bind(...needsName)
        .all<any>();
      driverNameMap = new Map((nameRows.results ?? []).map((r: any) => [r.custId, r.driverName]));
    }
  }

  const profiles: any[] = [];
  for (const custId of custIds) {
    const existingRow = rowsByCustId.get(custId);
    const lock = locksByCustId.get(custId);

    if (lock?.lockedAt) {
      profiles.push({
        custId,
        driverName: existingRow?.driverName ?? driverNameMap.get(custId) ?? `Driver ${custId}`,
        trackName: event.trackName,
        conditionProfileId,
        paceMs: lock.lockedPaceMs,
        paceSource: "manual",
        lapsUsed: existingRow?.lapsUsed ?? 0,
        sampleSize: existingRow?.sampleSize ?? 0,
        widenedBand: Boolean(existingRow?.widenedBand),
        fuelPerLap: lock.lockedFuelPerLap,
        fuelSource: "manual",
        pitTimeSeconds: existingRow?.pitTimeSeconds ?? null,
        pitTimeSource: existingRow?.pitTimeSource ?? null,
        computedAt: existingRow?.computedAt ?? null,
        locked: true,
      });
      continue;
    }

    if (existingRow) {
      let paceMs = existingRow.paceMs;
      let paceSource = existingRow.paceSource;
      if (paceMs === null && defaultPaceMs !== null) {
        paceMs = defaultPaceMs;
        paceSource = "race_default";
      }
      let fuelPerLap = existingRow.fuelPerLap;
      let fuelSource = existingRow.fuelSource;
      if (fuelPerLap === null && defaultFuelPerLap !== null) {
        fuelPerLap = defaultFuelPerLap;
        fuelSource = "race_default";
      }
      profiles.push({ ...existingRow, widenedBand: Boolean(existingRow.widenedBand), paceMs, paceSource, fuelPerLap, fuelSource, locked: false });
      continue;
    }

    if (defaultPaceMs !== null || defaultFuelPerLap !== null) {
      profiles.push({
        custId,
        driverName: driverNameMap.get(custId) ?? `Driver ${custId}`,
        trackName: event.trackName,
        conditionProfileId,
        paceMs: defaultPaceMs,
        paceSource: defaultPaceMs !== null ? "race_default" : null,
        lapsUsed: 0,
        sampleSize: 0,
        widenedBand: false,
        fuelPerLap: defaultFuelPerLap,
        fuelSource: defaultFuelPerLap !== null ? "race_default" : null,
        pitTimeSeconds: null,
        pitTimeSource: null,
        computedAt: null,
        locked: false,
      });
    }
    // else: no row, no lock, no default - omit, same "still finding pace/fuel data" state
    // as before this feature existed.
  }

  return json({ ok: true, eventId, profiles });
}
