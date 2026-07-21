import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { isPlanVisible } from "../../../../_lib/plannerRacePlan";
import { discoverAndSyncRecentSessionAtTrack } from "../../../../_lib/plannerLapDiscovery";
import { computeAndStoreOneDriverProfile } from "../../../../_lib/plannerDriverProfile";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Set/update a plan's driver lineup wholesale (same replace-the-whole-list pattern
 * stints.ts's PUT already uses). Gives LineupPage somewhere real to save to - until now
 * its driver picks only ever lived in local component state and were lost on navigation.
 *
 * Also kicks off a background "find a recent session at this track, then compute a pace/
 * fuel profile from it" pipeline for any driver newly added to the lineup (via
 * context.waitUntil - keeps running after this response returns), so a coordinator never
 * has to sit on the Lineup page, paste a subsession id, or press a "compute" button - by
 * the time they (or anyone else) checks back, there's a real profile or a definitive
 * "nothing found" result waiting, purely from adding the driver.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to edit the lineup." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(
    `SELECT p.id, p.race_weekend_id as raceWeekendId, e.track_name as trackName, e.track_config as trackConfig
     FROM race_plans p JOIN iracing_events e ON e.id = p.event_id WHERE p.id = ?`
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

  const previousRows = await DB.prepare(`SELECT cust_id as custId FROM race_plan_lineup WHERE race_plan_id = ?`).bind(planId).all<any>();
  const previousCustIds = new Set((previousRows.results ?? []).map((r: any) => r.custId));

  const body = await context.request.json().catch(() => null);
  const custIds: string[] = Array.isArray(body?.custIds) ? [...new Set(body.custIds.map(String).filter(Boolean))] : [];
  const newlyAddedCustIds = custIds.filter((id) => !previousCustIds.has(id));

  // Names for any driver just picked from the iRacing lookup (functions/api/planner/
  // drivers/search.ts) rather than gridrep's local drivers table - caches the real name
  // now instead of showing "Driver 123456" until some future sync happens to see them.
  const driverNames: Record<string, string> = body?.driverNames && typeof body.driverNames === "object" ? body.driverNames : {};
  const now = new Date().toISOString();
  for (const [custId, name] of Object.entries(driverNames)) {
    if (typeof name !== "string" || !name.trim()) continue;
    await DB.prepare(
      `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(iracing_member_id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`
    )
      .bind(custId, name.trim(), now)
      .run();
  }

  await DB.prepare(`DELETE FROM race_plan_lineup WHERE race_plan_id = ?`).bind(planId).run();
  for (const custId of custIds) {
    await DB.prepare(`INSERT OR IGNORE INTO race_plan_lineup (race_plan_id, cust_id) VALUES (?, ?)`).bind(planId, custId).run();
  }

  await DB.prepare(`UPDATE race_plans SET updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), planId).run();

  if (plan.trackName && newlyAddedCustIds.length > 0) {
    let garage61TeamSlug: string | null = null;
    if (plan.raceWeekendId) {
      const teamRow = await DB.prepare(
        `SELECT t.garage61_team_slug as slug FROM race_weekends w JOIN teams t ON t.id = w.team_id WHERE w.id = ?`
      )
        .bind(plan.raceWeekendId)
        .first<any>();
      garage61TeamSlug = teamRow?.slug ?? null;
    }
    await kickOffLapDiscovery(context, DB, plan.trackName, plan.trackConfig ?? null, garage61TeamSlug, newlyAddedCustIds, viewer.user!.id);
  }

  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName
     FROM race_plan_lineup l LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();

  return json({ ok: true, planId, lineup: rows.results ?? [] });
}

async function kickOffLapDiscovery(
  context: any,
  DB: any,
  trackName: string,
  trackConfig: string | null,
  garage61TeamSlug: string | null,
  custIds: string[],
  viewerUserId: string
): Promise<void> {
  const eligibleForSearch: string[] = [];
  const alreadyHaveLaps: string[] = [];

  for (const custId of custIds) {
    const existingLaps = await DB.prepare(
      `SELECT 1 FROM planner_iracing_laps l JOIN planner_iracing_subsessions s ON s.subsession_id = l.subsession_id
       WHERE l.cust_id = ? AND s.track_name = ? LIMIT 1`
    )
      .bind(custId, trackName)
      .first<any>();
    if (existingLaps) {
      // Already have real laps here - no search needed, but still worth computing a
      // profile now in case this is this driver's first time on this specific plan/event.
      alreadyHaveLaps.push(custId);
      continue;
    }

    const existingSearch = await DB.prepare(`SELECT status FROM driver_recent_session_search WHERE cust_id = ? AND track_name = ?`)
      .bind(custId, trackName)
      .first<any>();
    if (existingSearch && (existingSearch.status === "searching" || existingSearch.status === "found")) continue;

    eligibleForSearch.push(custId);
  }

  for (const custId of alreadyHaveLaps) {
    context.waitUntil(
      computeAndStoreOneDriverProfile(context, DB, {
        custId,
        trackName,
        trackConfig,
        conditionProfileId: null,
        tempMid: null,
        garage61TeamSlug,
      }).catch(() => {})
    );
  }

  if (eligibleForSearch.length === 0) return;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewerUserId);
  } catch (err: any) {
    // Record why, rather than vanishing silently - a driver's status badge should never
    // just stay blank with no trace of what happened.
    const now = new Date().toISOString();
    for (const custId of eligibleForSearch) {
      await DB.prepare(
        `INSERT INTO driver_recent_session_search (cust_id, track_name, status, subsession_id, message, updated_at)
         VALUES (?, ?, 'error', NULL, ?, ?)
         ON CONFLICT(cust_id, track_name) DO UPDATE SET status = 'error', message = excluded.message, updated_at = excluded.updated_at`
      )
        .bind(custId, trackName, `Could not get an access token to search: ${err?.message ?? String(err)}`, now)
        .run();
    }
    return;
  }

  const now = new Date().toISOString();
  for (const custId of eligibleForSearch) {
    await DB.prepare(
      `INSERT INTO driver_recent_session_search (cust_id, track_name, status, subsession_id, message, updated_at)
       VALUES (?, ?, 'searching', NULL, NULL, ?)
       ON CONFLICT(cust_id, track_name) DO UPDATE SET status = 'searching', message = NULL, updated_at = excluded.updated_at`
    )
      .bind(custId, trackName, now)
      .run();

    try {
      context.waitUntil(
        discoverAndSyncRecentSessionAtTrack(context, DB, custId, trackName, trackConfig, viewerUserId, accessToken, garage61TeamSlug)
      );
    } catch (err: any) {
      // context.waitUntil itself throwing (rather than the promise it's given rejecting)
      // is unusual, but make sure it's visible rather than leaving the row stuck on
      // "searching" forever if it ever happens.
      await DB.prepare(
        `UPDATE driver_recent_session_search SET status = 'error', message = ?, updated_at = ? WHERE cust_id = ? AND track_name = ?`
      )
        .bind(`waitUntil failed: ${err?.message ?? String(err)}`, new Date().toISOString(), custId, trackName)
        .run();
    }
  }
}
