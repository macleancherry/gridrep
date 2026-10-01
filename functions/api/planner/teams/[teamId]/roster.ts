import { getViewer } from "../../../../_lib/auth";
import { isTeamCoordinator } from "../../../../_lib/plannerTeams";
import { listTeamRosterIdentities, ensureDriverId, driverIdForCustId, grantConsent, revokeConsent } from "../../../../_lib/driverIdentity";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Admin roster screen (PRD: "A roster screen, visible only to team admins, manages
 * consent"). There's no site-wide admin role in gridrep, so this reuses the existing
 * per-team coordinator role - a coordinator manages consent for their own team's
 * roster, the same scope they already manage everything else in. This is the one UI
 * (besides driverIdentity.ts itself) allowed to see a raw custid/name pairing -
 * everywhere else only ever sees the opaque driver_id and a consent-gated name.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can view consent status for this team." });
  }

  const roster = await listTeamRosterIdentities(DB, teamId);
  return json({ ok: true, roster });
}

/** Grant consent for one driver. Capture is off-platform (a signed form or a
 * recorded "I agree" - see the PRD) - evidenceRef just points at that record (a form
 * ID or link); this endpoint only records that it happened and when. */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can grant consent for this team." });
  }

  const body = await context.request.json().catch(() => null);
  const custId = typeof body?.custId === "string" ? body.custId.trim() : "";
  const evidenceRef = typeof body?.evidenceRef === "string" ? body.evidenceRef.trim() : "";
  if (!custId) {
    return jsonError(400, { error: "invalid_cust_id", message: "custId is required." });
  }
  if (!evidenceRef) {
    return jsonError(400, { error: "invalid_evidence_ref", message: "A reference to the off-platform consent record (form ID or link) is required." });
  }

  const member = await DB.prepare(`SELECT 1 FROM team_members WHERE team_id = ? AND cust_id = ?`).bind(teamId, custId).first<any>();
  if (!member) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this team's roster." });
  }

  const driverId = await ensureDriverId(DB, custId);
  await grantConsent(DB, driverId, evidenceRef, viewer.user!.id);

  return json({ ok: true, driverId });
}

/** Revoke consent for one driver - anonymises them everywhere on the very next
 * request (displayDriver() checks driver_consent fresh every time). */
export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to manage this team's roster." });
  }

  const teamId = context.params.teamId as string;
  const { DB } = context.env;

  if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
    return jsonError(403, { error: "forbidden", message: "Only a coordinator can revoke consent for this team." });
  }

  const url = new URL(context.request.url);
  const custId = url.searchParams.get("custId") ?? "";
  if (!custId) {
    return jsonError(400, { error: "invalid_cust_id", message: "custId is required." });
  }

  const member = await DB.prepare(`SELECT 1 FROM team_members WHERE team_id = ? AND cust_id = ?`).bind(teamId, custId).first<any>();
  if (!member) {
    return jsonError(404, { error: "not_found", message: "That driver isn't on this team's roster." });
  }

  const driverId = await driverIdForCustId(DB, custId);
  if (!driverId) {
    return json({ ok: true }); // never had an identity resolved, so nothing to revoke
  }

  await revokeConsent(DB, driverId, viewer.user!.id);
  return json({ ok: true });
}
