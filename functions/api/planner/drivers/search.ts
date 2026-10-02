import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { fetchDriverLookup } from "../../../_lib/plannerIracing";
import { resolveDriverIds, displayDriversForViewer } from "../../../_lib/driverIdentity";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * Real-name driver search against iRacing itself, not gridrep's local `drivers` table
 * (functions/api/drivers/search.ts) - that table only knows drivers who've already
 * appeared in a synced session, so a team adding someone to a lineup for the first time
 * gets zero results there. Requires a verified viewer with a valid token, same as the
 * series/session endpoints - silently returns an empty list rather than an error when
 * unverified, so the frontend can just fall back to local-only results.
 *
 * A match's name is only shown back to the searcher when it's their own account or an
 * already-consented driver - any other verified user could otherwise use this as a
 * general-purpose "look up anyone's real iRacing identity by name" tool, which is more
 * disclosure than adding a driver to a roster needs. Every match still seeds
 * driver_identities (raw storage, not display - see driverIdentity.ts) so a coordinator
 * can add a brand-new person to a roster by their opaque driverId even without seeing
 * the name here; the name becomes visible once that driver actually consents.
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

  const { DB } = context.env;

  try {
    const results = await fetchDriverLookup(q, accessToken);
    // Seeds driver_identities with the real name iRacing's own lookup just gave us -
    // raw storage only (see driverIdentity.ts); whether it's ever shown is a separate,
    // consent-gated decision made below.
    const driverIdByCustId = await resolveDriverIds(
      DB,
      results.map((r) => ({ custId: r.custId, displayName: r.name }))
    );
    const display = await displayDriversForViewer(DB, [...driverIdByCustId.values()], viewer.user!.iracingId);

    return json({
      ok: true,
      results: results.map((r) => {
        const driverId = driverIdByCustId.get(r.custId)!;
        return { id: driverId, name: display.get(driverId)?.name ?? null };
      }),
    });
  } catch {
    // iRacing lookup failing shouldn't break the search box - local-DB results still work.
    return json({ ok: true, results: [] });
  }
}
