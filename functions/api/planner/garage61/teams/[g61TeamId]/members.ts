import { getViewer, getValidGarage61AccessToken } from "../../../../../_lib/auth";
import { fetchGarage61TeamDetail } from "../../../../../_lib/garage61";
import { json, jsonError } from "../../../../../_lib/httpJson";

/**
 * Lists one Garage 61 team's members for the import picker (TeamListPage.tsx/TeamPage.tsx)
 * so a coordinator can choose exactly who to bring onto the gridrep roster, rather than
 * import-garage61.ts pulling everyone in automatically. A member with no linked iRacing
 * account is still listed (so the coordinator can see they exist) but flagged - they can't
 * actually be imported, same "no cust_id, nothing to add" skip import-garage61.ts already
 * applies.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to browse this Garage 61 team." });
  }

  const g61TeamId = context.params.g61TeamId as string;

  const accessToken = await getValidGarage61AccessToken(context, viewer.user!.id).catch(() => null);
  if (!accessToken) {
    return jsonError(400, { error: "not_connected", message: "Connect Garage 61 first to browse this team." });
  }

  let detail;
  try {
    detail = await fetchGarage61TeamDetail(accessToken, g61TeamId);
  } catch (err: any) {
    return jsonError(502, { error: "garage61_unreachable", message: "Could not load that Garage 61 team. Please try again." });
  }

  const members = (detail.members ?? []).map((member) => {
    const iracingAccount = (member.accounts ?? []).find((a) => a.platform === "iracing");
    return {
      custId: iracingAccount?.id ?? null,
      name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.slug,
    };
  });

  return json({ ok: true, teamName: detail.name, members });
}
