import { getViewer } from "../../../../_lib/auth";
import { listVisiblePlansForEvent } from "../../../../_lib/plannerRacePlan";
import { json, jsonError } from "../../../../_lib/httpJson";

/** List race plans for an event, so the UI can resume an existing plan instead of always
 * creating a new one - only ones the viewer created or is rostered on (never another
 * team's plan for the same shared event). */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to list your plans for this event." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  const plans = await listVisiblePlansForEvent(DB, eventId, viewerIdentity);

  return json({ ok: true, eventId, plans });
}
