import { getViewer } from "../../../../_lib/auth";
import { isPlanVisible } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Set/update a plan's driver lineup wholesale (same replace-the-whole-list pattern
 * stints.ts's PUT already uses). Gives LineupPage somewhere real to save to - until now
 * its driver picks only ever lived in local component state and were lost on navigation.
 */
export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to edit the lineup." });
  }

  const planId = context.params.planId as string;
  const { DB } = context.env;

  const plan = await DB.prepare(`SELECT id FROM race_plans WHERE id = ?`).bind(planId).first<any>();
  if (!plan) {
    return jsonError(404, { error: "not_found", message: "Race plan not found." });
  }

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  if (!(await isPlanVisible(DB, planId, viewerIdentity))) {
    return jsonError(403, { error: "forbidden", message: "You don't have access to this plan." });
  }

  const body = await context.request.json().catch(() => null);
  const custIds: string[] = Array.isArray(body?.custIds) ? [...new Set(body.custIds.map(String).filter(Boolean))] : [];

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

  const rows = await DB.prepare(
    `SELECT l.cust_id as custId, d.display_name as driverName
     FROM race_plan_lineup l LEFT JOIN drivers d ON d.iracing_member_id = l.cust_id
     WHERE l.race_plan_id = ?`
  )
    .bind(planId)
    .all<any>();

  return json({ ok: true, planId, lineup: rows.results ?? [] });
}
