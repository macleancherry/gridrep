import { json, jsonError } from "../../../../../_lib/httpJson";

export async function onRequestPost(context: any) {
  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const result = await DB.prepare(`UPDATE event_pit_rules SET flagged_as_outdated = 1 WHERE event_id = ?`).bind(eventId).run();
  if (!result.meta || result.meta.changes === 0) {
    return jsonError(404, { error: "not_found", message: "No pit rules set for this event yet." });
  }

  return json({ ok: true, eventId, flaggedAsOutdated: true });
}
