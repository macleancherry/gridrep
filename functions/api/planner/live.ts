import { getViewer } from "../../_lib/auth";
import { listVisiblePlansForViewer } from "../../_lib/plannerRacePlan";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * "Live" sidebar destination (coordinator navigation rebuild, 2026-07-22) - every Car
 * Entry the viewer can see that's currently linked to live tracking (live_subsession_id
 * set via race-plans/[planId]/live.ts's PUT - a real coordinator-set link, not a guessed
 * time window), across every team and weekend.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to see live sessions." });
  }

  const { DB } = context.env;
  const viewerIdentity = { userId: viewer.user!.id, iracingId: viewer.user!.iracingId };
  const plans = await listVisiblePlansForViewer(DB, viewerIdentity, { onlyLive: true });

  return json({ ok: true, plans });
}
