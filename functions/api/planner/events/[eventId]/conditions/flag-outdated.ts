import { json, jsonError } from "../../../../../_lib/httpJson";

/** Marks a shared condition profile as needing re-capture (PRD §5.3 step 2). Any signed-in
 * user can flag it - the point is surfacing "this looks wrong" to whoever looks next, not
 * gatekeeping who's allowed to say so. */
export async function onRequestPost(context: any) {
  const eventId = context.params.eventId as string;
  const body = await context.request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId : null;

  if (!profileId) {
    return jsonError(400, { error: "invalid_profile_id", message: "profileId is required." });
  }

  const { DB } = context.env;
  const result = await DB.prepare(
    `UPDATE event_condition_profiles SET flagged_as_outdated = 1 WHERE id = ? AND event_id = ?`
  )
    .bind(profileId, eventId)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    return jsonError(404, { error: "not_found", message: "Condition profile not found for this event." });
  }

  return json({ ok: true, profileId, flaggedAsOutdated: true });
}
