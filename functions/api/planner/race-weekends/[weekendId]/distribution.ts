import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator, getWeekendTeamId } from "../../../../_lib/plannerTeams";
import { suggestDistribution, type WeekendAvailabilityBlock, type CarEntry } from "../../../../_lib/plannerDistribution";
import { json, jsonError } from "../../../../_lib/httpJson";

/** GET: a proposed driver-to-car split for this race weekend (PRD phase 6) - a draft, not
 *  a final decision (see plannerDistribution.ts for the algorithm and its explicit
 *  limitations). Coordinator-only, since only they act on it. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const teamId = await getWeekendTeamId(DB, weekendId);
  if (!teamId || !(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a team coordinator can view a distribution suggestion." });
  }

  const carsRows = await DB.prepare(
    `SELECT id as carId, name, availability_block_minutes as blockMinutes FROM race_plans WHERE race_weekend_id = ? ORDER BY created_at`
  )
    .bind(weekendId)
    .all<any>();
  const cars: CarEntry[] = (carsRows.results ?? []).map((r: any) => ({ carId: r.carId, name: r.name }));
  const blockMinutes = carsRows.results?.[0]?.blockMinutes ?? 60;

  const participantRows = await DB.prepare(
    `SELECT p.cust_id as custId, d.display_name as driverName
     FROM race_weekend_participants p LEFT JOIN drivers d ON d.iracing_member_id = p.cust_id
     WHERE p.race_weekend_id = ?`
  )
    .bind(weekendId)
    .all<any>();
  const participants = (participantRows.results ?? []).map((r: any) => ({ custId: r.custId, driverName: r.driverName }));

  const availRows = await DB.prepare(`SELECT cust_id as custId, status FROM driver_availability WHERE race_weekend_id = ?`)
    .bind(weekendId)
    .all<any>();
  const availabilityByCustId = new Map<string, WeekendAvailabilityBlock[]>();
  for (const r of (availRows.results ?? []) as any[]) {
    const list = availabilityByCustId.get(r.custId) ?? [];
    list.push({ custId: r.custId, status: r.status });
    availabilityByCustId.set(r.custId, list);
  }

  const result = suggestDistribution(participants, availabilityByCustId, cars, blockMinutes);

  return json({ ok: true, weekendId, ...result });
}

/** POST: writes the (possibly coordinator-edited) final assignments into each car's real
 *  lineup - replacing race_plan_lineup wholesale per car, same pattern lineup.ts already
 *  uses for a single Car Entry. Body: { assignments: { [carId]: custId[] } }. */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this race weekend." });
  }

  const weekendId = context.params.weekendId as string;
  const { DB } = context.env;

  const teamId = await getWeekendTeamId(DB, weekendId);
  if (!teamId || !(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a team coordinator can confirm a distribution." });
  }

  const body = await context.request.json().catch(() => null);
  const assignments = body?.assignments && typeof body.assignments === "object" ? body.assignments : {};

  // Confirm every carId in the payload really belongs to this weekend before writing
  // anything - a stray/forged carId shouldn't be able to touch an unrelated plan's lineup.
  const carsRows = await DB.prepare(`SELECT id FROM race_plans WHERE race_weekend_id = ?`).bind(weekendId).all<any>();
  const validCarIds = new Set((carsRows.results ?? []).map((r: any) => r.id));

  const statements: any[] = [];
  for (const [carId, custIds] of Object.entries(assignments)) {
    if (!validCarIds.has(carId) || !Array.isArray(custIds)) continue;
    statements.push(DB.prepare(`DELETE FROM race_plan_lineup WHERE race_plan_id = ?`).bind(carId));
    for (const custId of custIds as unknown[]) {
      if (typeof custId === "string" && custId) {
        statements.push(DB.prepare(`INSERT OR IGNORE INTO race_plan_lineup (race_plan_id, cust_id) VALUES (?, ?)`).bind(carId, custId));
      }
    }
  }
  if (statements.length > 0) await DB.batch(statements);

  return json({ ok: true, weekendId, carsUpdated: Object.keys(assignments).filter((id) => validCarIds.has(id)).length });
}
