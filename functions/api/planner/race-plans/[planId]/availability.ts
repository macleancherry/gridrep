import { getViewer } from "../../../../_lib/auth";
import { isPlanVisibleToTeam } from "../../../../_lib/plannerRacePlan";
import { ensureDriverIds, displayDrivers } from "../../../../_lib/driverIdentity";
import { json, jsonError } from "../../../../_lib/httpJson";

const VALID_STATUSES = new Set(["available", "maybe", "unavailable"]);

/** All drivers' availability for this plan (PRD §13.5/§13.6) - used to overlay the stint
 * builder. Team-visible by default (PRD §13.7.3) but still gated to the plan's own roster -
 * not visible to unrelated teams planning the same shared event. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view availability." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisibleToTeam(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  // driver_availability is scoped to this Car Entry, not the whole Race Weekend - a car can
  // now run a completely different race/session than another car in the same weekend, so
  // one shared weekend-level availability row would be ambiguous the moment that happens.
  const rows = await DB.prepare(
    `SELECT a.cust_id as custId, a.block_start_offset_minutes as blockStartOffsetMinutes, a.status, a.updated_at as updatedAt
     FROM driver_availability a WHERE a.race_plan_id = ? ORDER BY a.cust_id, a.block_start_offset_minutes`
  )
    .bind(planId)
    .all<any>();

  const driverIdByCustId = await ensureDriverIds(DB, (rows.results ?? []).map((r: any) => r.custId));
  const display = await displayDrivers(DB, [...driverIdByCustId.values()]);
  const gatedRows = (rows.results ?? []).map((r: any) => ({
    driverId: driverIdByCustId.get(r.custId),
    driverName: display.get(driverIdByCustId.get(r.custId)!)?.name ?? null,
    blockStartOffsetMinutes: r.blockStartOffsetMinutes,
    status: r.status,
    updatedAt: r.updatedAt,
  }));

  // Roster condition preferences (night/wet/start) - joined through users.iracing_member_id
  // since driver_condition_preferences is keyed by our internal user id, not cust_id.
  // Only covers drivers who've signed in at least once; anyone else simply doesn't show up
  // here (their availability rows/status are unaffected either way).
  const preferenceRows = await DB.prepare(
    `SELECT l.cust_id as custId, p.night_preference as nightPreference, p.wet_preference as wetPreference,
            p.start_preference as startPreference
     FROM race_plan_lineup l
     JOIN users u ON u.iracing_member_id = l.cust_id
     JOIN driver_condition_preferences p ON p.user_id = u.id
     WHERE l.race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();
  const preferenceDriverIdByCustId = await ensureDriverIds(DB, (preferenceRows.results ?? []).map((r: any) => r.custId));
  const preferences = (preferenceRows.results ?? []).map((r: any) => ({
    driverId: preferenceDriverIdByCustId.get(r.custId),
    nightPreference: r.nightPreference,
    wetPreference: r.wetPreference,
    startPreference: r.startPreference,
  }));

  return json({ ok: true, planId, availability: gatedRows, preferences });
}

/** Submit/update the authenticated driver's own availability (PRD §13.2/§13.5). */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to submit your availability." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisibleToTeam(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const body = await context.request.json().catch(() => null);
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  const timezone = typeof body?.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null;

  const custId = viewer.user!.iracingId;
  const now = new Date().toISOString();

  const statements: any[] = [];
  for (const b of blocks) {
    const offset = typeof b?.blockStartOffsetMinutes === "number" ? Math.trunc(b.blockStartOffsetMinutes) : null;
    const status = typeof b?.status === "string" ? b.status : null;
    if (offset === null || !status || !VALID_STATUSES.has(status)) {
      return jsonError(400, { error: "invalid_block", message: "Each block needs blockStartOffsetMinutes and a valid status." });
    }
    statements.push(
      DB.prepare(
        `INSERT INTO driver_availability (race_plan_id, cust_id, block_start_offset_minutes, status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(race_plan_id, cust_id, block_start_offset_minutes) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      ).bind(planId, custId, offset, status, now)
    );
  }
  if (statements.length > 0) await DB.batch(statements);

  if (timezone) {
    await DB.prepare(`UPDATE users SET timezone = ? WHERE id = ?`).bind(timezone, viewer.user!.id).run();
  }

  return json({ ok: true, planId, custId, blocksSaved: statements.length });
}
