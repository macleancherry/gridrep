import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { getCachedSeriesSummaries, describeIracingError, type SeriesSummary } from "../../_lib/plannerIracing";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * Series search (step 1 of the series -> session -> plan flow), tailored by the viewer's
 * onboarding preferences (format/discipline). Distinct from GET /api/planner/events
 * (which returns raw season rows) - this dedupes to one entry per series so the UI can
 * drill into a specific series' schedule next, via /api/planner/series/:seriesId/sessions.
 *
 * An empty category (viewer selected nothing, or hasn't onboarded) means "no preference"
 * for that category, not "show nothing" - only categories with an actual selection
 * filter. If filtering would leave zero results, fall back to the unfiltered list rather
 * than silently showing nothing (same "never silently return zero on a guess" principle
 * extractDiscoveredEvents already uses) - the response's `tailored` flag tells the
 * frontend which case it's in.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to browse series." });
  }

  const url = new URL(context.request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const { DB } = context.env;

  const prefsRows = await DB.prepare(`SELECT category, value FROM user_preferences WHERE user_id = ?`).bind(viewer.user!.id).all<any>();
  const formats = (prefsRows.results ?? []).filter((r: any) => r.category === "format").map((r: any) => r.value);
  const disciplines = (prefsRows.results ?? []).filter((r: any) => r.category === "discipline").map((r: any) => r.value);

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  let summaries: SeriesSummary[];
  let cachedAt: string;
  let stale: boolean;
  try {
    ({ series: summaries, cachedAt, stale } = await getCachedSeriesSummaries(DB, accessToken));
  } catch (err: any) {
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not list series from iRacing: ${describeIracingError(err)}` });
  }

  // "special" only ever applies to special-flagged rows, but "sprint" and "endurance"
  // both show up on plenty of regular (non-special) series too - confirmed live:
  // "Global Endurance Tour", "Creventic Endurance Series" etc. are regular series, not
  // one-off specials. Only skip regular series when the viewer wants special events
  // exclusively (or hasn't set a preference, matching the app's original special-only
  // default) - gating on "sprint" alone was hiding every regular endurance series from a
  // viewer who selected endurance without also selecting sprint. The cached summary list
  // is always the full superset (every series, special or not) - this filters it down
  // after the fact instead of at extraction time, since the "special" tag is already
  // there on every series regardless of who's asking.
  const includeRegularSeries = formats.includes("sprint") || formats.includes("endurance");
  const all = includeRegularSeries ? summaries : summaries.filter((s) => s.formats.includes("special"));

  function matchesPreferences(s: SeriesSummary): boolean {
    const formatOk = formats.length === 0 || s.formats.some((f) => formats.includes(f));
    const disciplineOk = disciplines.length === 0 || s.disciplines.length === 0 || s.disciplines.some((d) => disciplines.includes(d));
    return formatOk && disciplineOk;
  }

  const hasPreferences = formats.length > 0 || disciplines.length > 0;
  const tailoredList = hasPreferences ? all.filter(matchesPreferences) : all;
  const tailored = hasPreferences && tailoredList.length > 0;
  let series = tailored ? tailoredList : all;

  if (q) series = series.filter((s) => s.name.toLowerCase().includes(q));

  return json({ ok: true, series, tailored, hasPreferences, cachedAt, stale });
}
