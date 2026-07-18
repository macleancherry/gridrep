import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { fetchDriverLookup } from "../../../_lib/plannerIracing";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * Real-name driver search against iRacing itself, not gridrep's local `drivers` table
 * (functions/api/drivers/search.ts) - that table only knows drivers who've already
 * appeared in a synced session, so a team adding someone to a lineup for the first time
 * gets zero results there. Requires a verified viewer with a valid token, same as the
 * series/session endpoints - silently returns an empty list rather than an error when
 * unverified, so the frontend can just fall back to local-only results.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return json({ ok: true, results: [] });
  }

  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return json({ ok: true, results: [] });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return json({ ok: true, results: [] });
  }

  try {
    const results = await fetchDriverLookup(q, accessToken);
    return json({ ok: true, results: results.map((r) => ({ id: r.custId, name: r.name })) });
  } catch {
    // iRacing lookup failing shouldn't break the search box - local-DB results still work.
    return json({ ok: true, results: [] });
  }
}
