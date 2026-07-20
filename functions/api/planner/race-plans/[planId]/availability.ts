import { getViewer } from "../../../../_lib/auth";
import { isPlanVisible } from "../../../../_lib/plannerRacePlan";
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
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  // driver_availability is scoped to the Race Weekend, not the individual Car Entry - a
  // driver's real-world free time doesn't depend on which car they end up in. Every plan
  // has exactly one weekend today (transparently created in createRacePlan), so this reads
  // as one weekend's availability, same as it always has for this single-car case.
  const plan = await DB.prepare(`SELECT race_weekend_id as raceWeekendId FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  const raceWeekendId = plan?.raceWeekendId;

  const rows = raceWeekendId
    ? await DB.prepare(
        `SELECT a.cust_id as custId, d.display_name as driverName, a.block_start_offset_minutes as blockStartOffsetMinutes,
                a.status, a.updated_at as updatedAt
         FROM driver_availability a LEFT JOIN drivers d ON d.iracing_member_id = a.cust_id
         WHERE a.race_weekend_id = ? ORDER BY a.cust_id, a.block_start_offset_minutes`
      )
        .bind(raceWeekendId)
        .all<any>()
    : { results: [] };

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

  return json({ ok: true, planId, availability: rows.results ?? [], preferences: preferenceRows.results ?? [] });
}

/** Submit/update the authenticated driver's own availability (PRD §13.2/§13.5). */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to submit your availability." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id, race_weekend_id as raceWeekendId FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }
  if (!plan.raceWeekendId) {
    // Every plan created via createRacePlan() gets a weekend automatically - this can only
    // happen for a pre-migration-0022 plan somehow missed by the backfill.
    return jsonError(500, { error: "no_weekend", message: "This plan has no race weekend - please contact support." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
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
        `INSERT INTO driver_availability (race_weekend_id, cust_id, block_start_offset_minutes, status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(race_weekend_id, cust_id, block_start_offset_minutes) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      ).bind(plan.raceWeekendId, custId, offset, status, now)
    );
  }
  if (statements.length > 0) await DB.batch(statements);

  if (timezone) {
    await DB.prepare(`UPDATE users SET timezone = ? WHERE id = ?`).bind(timezone, viewer.user!.id).run();
  }

  return json({ ok: true, planId, custId, blocksSaved: statements.length });
}
