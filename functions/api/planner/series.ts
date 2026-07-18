import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { fetchSeasonList, extractSeriesList, describeIracingError } from "../../_lib/plannerIracing";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * Special-event series search (step 1 of the series -> session -> plan flow). Distinct
 * from GET /api/planner/events (which returns raw season rows) - this dedupes to one
 * entry per series so the UI can drill into a specific series' schedule next, via
 * /api/planner/series/:seriesId/sessions.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to browse series." });
  }

  const url = new URL(context.request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  let payload: any;
  try {
    payload = await fetchSeasonList(accessToken);
  } catch (err: any) {
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not list series from iRacing: ${describeIracingError(err)}` });
  }

  let series = extractSeriesList(payload);
  if (q) series = series.filter((s) => s.name.toLowerCase().includes(q));

  return json({ ok: true, series });
}
