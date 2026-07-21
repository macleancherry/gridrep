import { getViewer } from "../../../../_lib/auth";
import { computeAndStoreOneDriverProfile, driverProfileRowId } from "../../../../_lib/plannerDriverProfile";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Driver track/condition profile computation (PRD §4 steps 4-5, §6, §7). Reads whatever
 * laps have already been synced into planner_iracing_laps/subsessions for this track (via
 * /api/planner/iracing/subsessions/:id/sync) - this endpoint doesn't itself discover or
 * pull new iRacing data, it computes over what's already stored, same separation Pace's
 * own /pace endpoint keeps between ingest and compute.
 *
 * Fuel-per-lap prefers real Garage 61 data (plannerGarage61Fuel.ts) when a confident match
 * is available, falling back to manual entry (PRD §5.2/§5.4's required fallback) otherwise.
 * A driver's own explicit manual entry always wins and is never silently overwritten by a
 * real-data lookup on a later recompute.
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
    const result = await computeAndStoreOneDriverProfile(context, DB, {
      custId,
      trackName: event.trackName,
      trackConfig: event.trackConfig ?? null,
      conditionProfileId,
      tempMid,
      garage61TeamSlug,
      fuelOverride: typeof overrideFuel === "number" && Number.isFinite(overrideFuel) ? overrideFuel : undefined,
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

  const event = await DB.prepare(`SELECT track_name as trackName FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event?.trackName) {
    return json({ ok: true, eventId, profiles: [] });
  }

  const custIds = custIdsParam ? custIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (custIds.length === 0) {
    return json({ ok: true, eventId, profiles: [] });
  }

  const ids = custIds.map((custId) => driverProfileRowId(custId, event.trackName, conditionProfileId));
  const placeholders = ids.map(() => "?").join(",");

  const rows = await DB.prepare(
    `SELECT p.cust_id as custId, d.display_name as driverName, p.track_name as trackName,
            p.condition_profile_id as conditionProfileId, p.pace_ms as paceMs, p.laps_used as lapsUsed,
            p.sample_size as sampleSize, p.widened_band as widenedBand, p.fuel_per_lap as fuelPerLap,
            p.fuel_source as fuelSource, p.pit_time_seconds as pitTimeSeconds, p.pit_time_source as pitTimeSource,
            p.computed_at as computedAt
     FROM driver_track_profiles p
     LEFT JOIN drivers d ON d.iracing_member_id = p.cust_id
     WHERE p.id IN (${placeholders})`
  )
    .bind(...ids)
    .all<any>();

  return json({
    ok: true,
    eventId,
    profiles: (rows.results ?? []).map((r: any) => ({ ...r, widenedBand: Boolean(r.widenedBand) })),
  });
}
