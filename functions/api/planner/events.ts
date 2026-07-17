import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { fetchSeasonList, extractDiscoveredEvents, describeIracingError } from "../../_lib/plannerIracing";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * Special/endurance event discovery (PRD §4 step 1, §8). Built defensively per the
 * audit/spike report: the exact iRacing endpoint and the field that distinguishes a
 * "special event" season from a regular series season are unconfirmed (no live access
 * token available during the spike) - see plannerIracing.ts's fetchSeasonList/
 * extractDiscoveredEvents for the fallback/heuristic logic this leans on. Requires a
 * verified session since discovery itself needs an iRacing access token.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to browse events." });
  }

  const url = new URL(context.request.url);
  const type = url.searchParams.get("type");
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
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not list events from iRacing: ${describeIracingError(err)}` });
  }

  let events = extractDiscoveredEvents(payload, { specialOnly: type === "special" });

  if (q) {
    events = events.filter((e) => e.name.toLowerCase().includes(q));
  }

  return json({ ok: true, events: events.map(({ raw, ...rest }) => rest) });
}
