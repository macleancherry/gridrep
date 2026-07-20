import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { iracingDataGet } from "../../../_lib/iracing";
import { json, jsonError } from "../../../_lib/httpJson";

// iRacing's four license categories - category_id 1/2 already confirmed live elsewhere in
// this codebase (functions/_lib/recent.ts's irating refresh reads the same licenses[]
// shape); 3/4 follow the same well-known ordering but haven't been directly confirmed
// against a real payload yet - treat as provisional until verified with a live token.
const CATEGORY_TO_DISCIPLINE: Record<number, string> = {
  1: "oval",
  2: "road",
  3: "dirt_oval",
  4: "dirt_road",
};

// No "starts" field has been confirmed on this payload anywhere in this codebase - using
// "has this license been promoted out of Rookie" as a proxy for "has actually raced this
// discipline" instead of guessing at an unconfirmed field name. Advisory only: this only
// ever pre-checks a card, never asserts a fact the driver can't immediately see and undo.
function hasRacedCategory(license: any): boolean {
  const groupName = typeof license?.group_name === "string" ? license.group_name.toLowerCase() : "";
  if (groupName) return !groupName.includes("rookie");
  if (typeof license?.license_level === "number") return license.license_level > 1;
  return false;
}

/**
 * Best-effort discipline suggestions for the onboarding wizard (WelcomePage.tsx step 1),
 * sourced from the viewer's own real iRacing license data instead of asking them to pick
 * blind. Never persists anything and never fails onboarding - any lookup failure just
 * means no suggestions, same "surface it, don't gatekeep" rule used everywhere else in
 * this app for a best-effort enrichment.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return json({ ok: true, suggestedDisciplines: [] });
  }

  try {
    const data: any = await iracingDataGet<any>(
      `/data/member/get?cust_ids=${encodeURIComponent(viewer.user!.iracingId)}&include_licenses=true`,
      accessToken
    );

    const member =
      (Array.isArray(data?.members) && data.members.find((m: any) => String(m?.cust_id) === viewer.user!.iracingId)) ||
      (Array.isArray(data?.members) && data.members[0]) ||
      data;

    const licenses: any[] = Array.isArray(member?.licenses) ? member.licenses : [];
    const suggestedDisciplines = [
      ...new Set(
        licenses
          .filter(hasRacedCategory)
          .map((l) => CATEGORY_TO_DISCIPLINE[l?.category_id])
          .filter((d): d is string => Boolean(d))
      ),
    ];

    return json({ ok: true, suggestedDisciplines });
  } catch (err: any) {
    console.error(JSON.stringify({ level: "warn", msg: "planner.member_profile.lookup_failed", message: err?.message ?? String(err) }));
    return json({ ok: true, suggestedDisciplines: [] });
  }
}
