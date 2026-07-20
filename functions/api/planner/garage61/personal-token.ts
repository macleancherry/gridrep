import { getViewer } from "../../../_lib/auth";
import { garage61ApiGet, fetchGarage61Accounts, type Garage61Me, Garage61HttpError } from "../../../_lib/garage61";
import { json, jsonError } from "../../../_lib/httpJson";

// A personal access token doesn't expire the way an OAuth access token does - it's
// revoked/rotated manually on garage61.net, not refreshed. Storing a far-future
// access_expires_at (rather than NULL, which the schema doesn't allow) means
// getValidGarage61AccessToken's existing "still fresh" branch returns it directly and
// never attempts an OAuth-style refresh (refresh_token stays NULL, which is exactly the
// signal that branch is gated on).
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Alternative to the OAuth connect flow (auth/garage61/start.ts + callback.ts) - same
 * underlying bearer-token mechanism (garage61ApiGet doesn't care where the token came
 * from), just skipping the authorization-code round trip entirely. Exists because Garage
 * 61 OAuth is currently blocked on real client_id/secret from their support; a personal
 * access token (created directly on garage61.net) works today with zero external
 * dependency.
 */
export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to connect Garage 61." });
  }

  const body = await context.request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return jsonError(400, { error: "invalid_token", message: "Paste your Garage 61 personal access token." });
  }

  let me: Garage61Me;
  try {
    me = await garage61ApiGet<Garage61Me>("/me", token);
  } catch (err: any) {
    if (err instanceof Garage61HttpError && err.status === 401) {
      return jsonError(400, { error: "invalid_token", message: "That token was rejected by Garage 61 - check it and try again." });
    }
    return jsonError(502, { error: "garage61_unreachable", message: "Could not reach Garage 61 to verify that token. Please try again." });
  }

  if (!me?.id) {
    return jsonError(400, { error: "invalid_token", message: "That token was rejected by Garage 61 - check it and try again." });
  }

  let iracingCustId: string | null = null;
  try {
    const accounts = await fetchGarage61Accounts(token);
    iracingCustId = (accounts.items ?? []).find((a) => a.platform === "iracing")?.id ?? null;
  } catch {
    // Best-effort, same as the OAuth callback path - a driver who hasn't linked iRacing
    // inside Garage 61 itself shouldn't block the connection.
  }

  const { DB } = context.env;
  const now = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + TEN_YEARS_MS).toISOString();

  await DB.prepare(
    `INSERT INTO garage61_oauth_tokens
       (user_id, garage61_user_id, garage61_slug, access_token, refresh_token, access_expires_at, scope, iracing_cust_id, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       garage61_user_id=excluded.garage61_user_id,
       garage61_slug=excluded.garage61_slug,
       access_token=excluded.access_token,
       refresh_token=NULL,
       access_expires_at=excluded.access_expires_at,
       scope=excluded.scope,
       iracing_cust_id=COALESCE(excluded.iracing_cust_id, garage61_oauth_tokens.iracing_cust_id),
       updated_at=excluded.updated_at`
  )
    .bind(viewer.user!.id, me.id, me.slug ?? null, token, accessExpiresAt, iracingCustId, now)
    .run();

  return json({ ok: true, garage61Name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.slug, iracingCustId });
}
