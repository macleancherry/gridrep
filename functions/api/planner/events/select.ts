import { getViewer } from "../../../_lib/auth";
import { upsertIracingEvent } from "../../../_lib/plannerIracing";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * Upserts a discovered event (the shape GET /api/planner/events returns) into the
 * planner's iracing_events table, so it has a stable id that condition profiles,
 * race plans, etc. can attach to. Keyed on the event's own id (season-X / series-X),
 * per the PRD's "same event + scheduled start resolves to one record" rule (§7) -
 * calling this again for an event that's already stored just refreshes its fields.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to select an event." });
  }

  const body = await context.request.json().catch(() => null);
  const id = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (!id || !name) {
    return jsonError(400, { error: "invalid_event", message: "id and name are required." });
  }

  const eventType = body?.eventType === "special" || body?.eventType === "hosted" ? body.eventType : "league";

  const event = await upsertIracingEvent(context.env.DB, {
    id,
    name,
    trackName: body?.trackName ?? null,
    trackConfig: body?.trackConfig ?? null,
    eventType,
    scheduledStartTime: body?.scheduledStartTime ?? null,
    durationMinutes: body?.durationMinutes ?? null,
    seriesId: body?.seriesId ?? null,
    seasonId: body?.seasonId ?? null,
  });

  return json({ ok: true, event });
}
