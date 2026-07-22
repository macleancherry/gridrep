import { getViewer } from "../../_lib/auth";
import { listVisiblePlansForViewer } from "../../_lib/plannerRacePlan";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * "Plans" sidebar destination (coordinator navigation rebuild, 2026-07-22) - every Car
 * Entry the viewer can see across every team and weekend, not a per-event listing.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to see your plans." });
  }

  const { DB } = context.env;
  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  const plans = await listVisiblePlansForViewer(DB, viewerIdentity);

  return json({ ok: true, plans });
}
