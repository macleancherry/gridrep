import { getViewer, getValidGarage61AccessToken } from "../../../../../_lib/auth";
import { fetchGarage61TeamDetail } from "../../../../../_lib/garage61";
import { resolveDriverIds } from "../../../../../_lib/driverIdentity";
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

  const rawMembers = (detail.members ?? []).map((member) => {
    const iracingAccount = (member.accounts ?? []).find((a) => a.platform === "iracing");
    return {
      custId: iracingAccount?.id ? String(iracingAccount.id) : null,
      name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.slug,
    };
  });

  // The real iRacing custid behind a linked account never leaves the Worker - resolved
  // to an opaque driverId instead (seeded here, storage only - see driverIdentity.ts).
  // The Garage 61 profile name itself isn't gated: it's that service's own data, not
  // gridrep's iRacing identity cache, and is what the coordinator needs to pick the
  // right person to import.
  const custIds = rawMembers.map((m) => m.custId).filter((id): id is string => Boolean(id));
  const driverIdByCustId = await resolveDriverIds(
    context.env.DB,
    custIds.map((custId) => ({ custId }))
  );
  const members = rawMembers.map((m) => ({
    driverId: m.custId ? driverIdByCustId.get(m.custId) ?? null : null,
    name: m.name,
  }));

  return json({ ok: true, teamName: detail.name, members });
}
