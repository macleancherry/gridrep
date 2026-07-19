import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { getCachedSchedulesForSeries, describeIracingError } from "../../../../_lib/plannerIracing";
import { json, jsonError } from "../../../../_lib/httpJson";

/** Step 2: list a series' scheduled sessions (race weeks) - almost always exactly one
 * for a genuine special event, since those are one-off rather than recurring weekly. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to browse sessions." });
  }

  const seriesId = context.params.seriesId as string;
  const { DB } = context.env;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  let sessions: Awaited<ReturnType<typeof getCachedSchedulesForSeries>>["sessions"];
  let cachedAt: string;
  let stale: boolean;
  try {
    ({ sessions, cachedAt, stale } = await getCachedSchedulesForSeries(DB, accessToken, seriesId));
  } catch (err: any) {
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not list sessions from iRacing: ${describeIracingError(err)}` });
  }

  return json({ ok: true, seriesId, sessions, cachedAt, stale });
}
