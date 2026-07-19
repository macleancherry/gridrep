import { getViewer } from "../../_lib/auth";
import { json, jsonError } from "../../_lib/httpJson";

const VALID = new Set(["prefer", "neutral", "avoid"]);

/**
 * Standing per-driver condition preferences (night/wet/race-start) - distinct from
 * /api/planner/preferences (which events to search for), this is what kind of stint a
 * driver wants within an event they're already on. Carries across every plan, same as
 * the onboarding preferences. Defaults to "neutral" for a driver who's never set one -
 * GET always returns all three fields, never a missing/null value the frontend would
 * have to special-case.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const { DB } = context.env;
  const row = await DB.prepare(
    `SELECT night_preference as nightPreference, wet_preference as wetPreference, start_preference as startPreference
     FROM driver_condition_preferences WHERE user_id = ?`
  )
    .bind(viewer.user!.id)
    .first<any>();

  return json({
    ok: true,
    preferences: {
      nightPreference: row?.nightPreference ?? "neutral",
      wetPreference: row?.wetPreference ?? "neutral",
      startPreference: row?.startPreference ?? "neutral",
    },
  });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const body = await context.request.json().catch(() => null);
  const nightPreference = typeof body?.nightPreference === "string" ? body.nightPreference : "neutral";
  const wetPreference = typeof body?.wetPreference === "string" ? body.wetPreference : "neutral";
  const startPreference = typeof body?.startPreference === "string" ? body.startPreference : "neutral";

  for (const [name, value] of [
    ["nightPreference", nightPreference],
    ["wetPreference", wetPreference],
    ["startPreference", startPreference],
  ]) {
    if (!VALID.has(value)) {
      return jsonError(400, { error: "invalid_value", message: `${name} must be one of prefer/neutral/avoid.` });
    }
  }

  const { DB } = context.env;
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO driver_condition_preferences (user_id, night_preference, wet_preference, start_preference, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       night_preference = excluded.night_preference,
       wet_preference = excluded.wet_preference,
       start_preference = excluded.start_preference,
       updated_at = excluded.updated_at`
  )
    .bind(viewer.user!.id, nightPreference, wetPreference, startPreference, now)
    .run();

  return json({ ok: true });
}
