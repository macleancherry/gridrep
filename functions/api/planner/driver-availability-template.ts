import { getViewer } from "../../_lib/auth";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * A driver's standing weekly free-time pattern (PRD: "standard availability template" -
 * "then your standard availability... so you don't have to go and set availability per
 * race"). Stored in the driver's own local wall-clock time (day-of-week + minute-of-day),
 * projected onto a specific race weekend's real calendar days client-side (see
 * AvailabilityPage.tsx's "prefill from my template") - never stored pre-converted to any
 * one weekend's UTC offsets, since the same template needs to project differently onto
 * different weekends.
 */
const MAX_ENTRIES = 40;

export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const { DB } = context.env;
  const rows = await DB.prepare(
    `SELECT day_of_week as dayOfWeek, start_minute_of_day as startMinuteOfDay, end_minute_of_day as endMinuteOfDay
     FROM driver_availability_template WHERE user_id = ? ORDER BY day_of_week, start_minute_of_day`
  )
    .bind(viewer.user!.id)
    .all<any>();

  return json({ ok: true, template: rows.results ?? [] });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const body = await context.request.json().catch(() => null);
  const entries = Array.isArray(body?.template) ? body.template : [];
  if (entries.length > MAX_ENTRIES) {
    return jsonError(400, { error: "too_many_entries", message: `A template can have at most ${MAX_ENTRIES} blocks.` });
  }

  const rows: { dayOfWeek: number; startMinuteOfDay: number; endMinuteOfDay: number }[] = [];
  for (const e of entries) {
    const dayOfWeek = Number.isInteger(e?.dayOfWeek) ? e.dayOfWeek : NaN;
    const startMinuteOfDay = Number.isInteger(e?.startMinuteOfDay) ? e.startMinuteOfDay : NaN;
    const endMinuteOfDay = Number.isInteger(e?.endMinuteOfDay) ? e.endMinuteOfDay : NaN;
    if (
      dayOfWeek < 0 || dayOfWeek > 6 ||
      startMinuteOfDay < 0 || startMinuteOfDay > 1439 ||
      endMinuteOfDay <= startMinuteOfDay || endMinuteOfDay > 1440
    ) {
      return jsonError(400, {
        error: "invalid_entry",
        message: "Each block needs dayOfWeek (0-6), startMinuteOfDay, and a later endMinuteOfDay.",
      });
    }
    rows.push({ dayOfWeek, startMinuteOfDay, endMinuteOfDay });
  }

  const { DB } = context.env;
  const userId = viewer.user!.id;

  const statements = [
    DB.prepare(`DELETE FROM driver_availability_template WHERE user_id = ?`).bind(userId),
    ...rows.map((r) =>
      DB.prepare(
        `INSERT INTO driver_availability_template (user_id, day_of_week, start_minute_of_day, end_minute_of_day)
         VALUES (?, ?, ?, ?)`
      ).bind(userId, r.dayOfWeek, r.startMinuteOfDay, r.endMinuteOfDay)
    ),
  ];
  await DB.batch(statements);

  return json({ ok: true, template: rows });
}
