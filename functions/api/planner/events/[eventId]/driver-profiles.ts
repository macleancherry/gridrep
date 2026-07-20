import { getViewer } from "../../../../_lib/auth";
import { computeDriverTrackProfile, computePitTimeSeconds, type LapRow } from "../../../../_lib/plannerDriverProfile";
import { resolveGarage61Fuel } from "../../../../_lib/plannerGarage61Fuel";
import { json, jsonError } from "../../../../_lib/httpJson";

function profileRowId(custId: string, trackName: string, conditionProfileId: string | null): string {
  return `${custId}:${trackName}:${conditionProfileId ?? "none"}`;
}

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

  const now = new Date().toISOString();
  const results: any[] = [];

  for (const custId of custIds) {
    const lapsRes = await DB.prepare(
      `SELECT l.lap_time_ms as lapTimeMs, l.is_pit_lap as isPitLap, l.is_clean as isClean, s.track_temp as trackTemp
       FROM planner_iracing_laps l
       JOIN planner_iracing_subsessions s ON s.subsession_id = l.subsession_id
       WHERE s.track_name = ? AND l.cust_id = ?`
    )
      .bind(event.trackName, custId)
      .all<any>();

    const laps: LapRow[] = (lapsRes.results ?? []).map((r: any) => ({
      lapTimeMs: r.lapTimeMs,
      isPitLap: Boolean(r.isPitLap),
      isClean: r.isClean === null ? null : Boolean(r.isClean),
      trackTemp: r.trackTemp,
    }));

    const computed = computeDriverTrackProfile(custId, event.trackName, laps, { tempMid });
    const pitTimeSeconds = computePitTimeSeconds(laps, computed.paceMs);

    const rowId = profileRowId(custId, event.trackName, conditionProfileId);
    const existing = await DB.prepare(`SELECT fuel_per_lap as fuelPerLap, fuel_source as fuelSource FROM driver_track_profiles WHERE id = ?`)
      .bind(rowId)
      .first<any>();

    const overrideFuel = fuelOverrides[custId];
    let fuelPerLap: number | null;
    let fuelSource: string | null;

    if (typeof overrideFuel === "number" && Number.isFinite(overrideFuel)) {
      // An explicit manual entry for this call always wins - never overwritten by a guess.
      fuelPerLap = overrideFuel;
      fuelSource = "manual";
    } else if (existing?.fuelSource === "manual") {
      // A human already vetted this value - don't silently clobber it with real data that
      // might reflect a different car/conditions than what they actually confirmed.
      fuelPerLap = existing.fuelPerLap;
      fuelSource = existing.fuelSource;
    } else {
      const garage61Result = await resolveGarage61Fuel(context, DB, custId, event.trackName, event.trackConfig ?? null);
      if (garage61Result) {
        fuelPerLap = garage61Result.fuelPerLap;
        fuelSource = garage61Result.source;
      } else {
        fuelPerLap = existing?.fuelPerLap ?? null;
        fuelSource = fuelPerLap === null ? null : (existing?.fuelSource ?? "manual");
      }
    }

    const pitTimeSource = pitTimeSeconds === null ? null : "derived";

    await DB.prepare(
      `INSERT INTO driver_track_profiles (
         id, cust_id, track_name, condition_profile_id, pace_ms, laps_used, sample_size,
         widened_band, fuel_per_lap, fuel_source, pit_time_seconds, pit_time_source, computed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         pace_ms = excluded.pace_ms,
         laps_used = excluded.laps_used,
         sample_size = excluded.sample_size,
         widened_band = excluded.widened_band,
         fuel_per_lap = excluded.fuel_per_lap,
         fuel_source = excluded.fuel_source,
         pit_time_seconds = excluded.pit_time_seconds,
         pit_time_source = excluded.pit_time_source,
         computed_at = excluded.computed_at`
    )
      .bind(
        rowId,
        custId,
        event.trackName,
        conditionProfileId,
        computed.paceMs,
        computed.lapsUsed,
        computed.sampleSize,
        computed.widenedBand ? 1 : 0,
        fuelPerLap,
        fuelSource,
        pitTimeSeconds,
        pitTimeSource,
        now
      )
      .run();

    const driver = await DB.prepare(`SELECT display_name as driverName FROM drivers WHERE iracing_member_id = ?`).bind(custId).first<any>();

    results.push({
      custId,
      driverName: driver?.driverName ?? `Driver ${custId}`,
      trackName: event.trackName,
      conditionProfileId,
      ok: computed.ok,
      reason: computed.reason,
      paceMs: computed.paceMs,
      lapsUsed: computed.lapsUsed,
      sampleSize: computed.sampleSize,
      widenedBand: computed.widenedBand,
      bandWidthC: computed.bandWidthC,
      fuelPerLap,
      fuelSource,
      pitTimeSeconds,
      pitTimeSource,
    });
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

  const ids = custIds.map((custId) => profileRowId(custId, event.trackName, conditionProfileId));
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
