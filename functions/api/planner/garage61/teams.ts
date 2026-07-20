import { getViewer, getValidGarage61AccessToken } from "../../../_lib/auth";
import { fetchGarage61Teams } from "../../../_lib/garage61";
import { json, jsonError } from "../../../_lib/httpJson";

/** Lists the viewer's own joined Garage 61 teams, for the "import a team's roster" picker
 *  on TeamListPage.tsx / TeamPage.tsx. Only ever sees teams the *connecting* driver
 *  personally belongs to - a real Garage 61 API limitation (a personal token/OAuth grant
 *  can't see a team its owner isn't in), accepted as-is rather than worked around. */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to browse your Garage 61 teams." });
  }

  const accessToken = await getValidGarage61AccessToken(context, viewer.user!.id).catch(() => null);
  if (!accessToken) {
    return jsonError(400, { error: "not_connected", message: "Connect Garage 61 first to import a team." });
  }

  try {
    const { items } = await fetchGarage61Teams(accessToken);
    return json({ ok: true, teams: items ?? [] });
  } catch (err: any) {
    return jsonError(502, { error: "garage61_unreachable", message: "Could not load your Garage 61 teams. Please try again." });
  }
}
