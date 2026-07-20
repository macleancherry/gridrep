import { getViewer } from "../../../../_lib/auth";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Poll target for the background lap-discovery search kicked off by race-plans/:planId/
 * lineup.ts's PUT (see plannerLapDiscovery.ts). Reports against this event's own track,
 * synthesizing "found" whenever real laps already exist for a driver at this track
 * regardless of what the search-status row says (or whether one exists at all) - the laps
 * themselves are the ground truth, the status row is just progress tracking for a search
 * that may never have needed to run.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const custIds = (url.searchParams.get("custIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (custIds.length === 0) {
    return json({ ok: true, eventId, results: [] });
  }

  const event = await DB.prepare(`SELECT track_name as trackName FROM iracing_events WHERE id = ?`).bind(eventId).first<any>();
  if (!event?.trackName) {
    return json({ ok: true, eventId, results: custIds.map((custId) => ({ custId, status: "none" as const })) });
  }
  const trackName = event.trackName as string;

  const placeholders = custIds.map(() => "?").join(",");

  const lapRows = await DB.prepare(
    `SELECT DISTINCT l.cust_id as custId FROM planner_iracing_laps l
     JOIN planner_iracing_subsessions s ON s.subsession_id = l.subsession_id
     WHERE s.track_name = ? AND l.cust_id IN (${placeholders})`
  )
    .bind(trackName, ...custIds)
    .all<any>();
  const hasLaps = new Set((lapRows.results ?? []).map((r: any) => r.custId));

  const searchRows = await DB.prepare(
    `SELECT cust_id as custId, status, subsession_id as subsessionId, message, updated_at as updatedAt
     FROM driver_recent_session_search WHERE track_name = ? AND cust_id IN (${placeholders})`
  )
    .bind(trackName, ...custIds)
    .all<any>();
  const searchByCustId = new Map((searchRows.results ?? []).map((r: any) => [r.custId, r]));

  const results = custIds.map((custId) => {
    if (hasLaps.has(custId)) {
      const search = searchByCustId.get(custId);
      return {
        custId,
        status: "found" as const,
        message: search?.message ?? "Real laps already available at this track.",
        updatedAt: search?.updatedAt ?? null,
      };
    }
    const search = searchByCustId.get(custId);
    if (!search) return { custId, status: "none" as const };
    return { custId, status: search.status, message: search.message ?? null, updatedAt: search.updatedAt };
  });

  return json({ ok: true, eventId, trackName, results });
}
