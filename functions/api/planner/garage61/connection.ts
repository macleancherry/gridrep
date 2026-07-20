import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

/** Connection status + disconnect for whichever Garage 61 connect method the viewer used
 *  (OAuth or a pasted personal token - distinguished by refresh_token IS NULL rather than a
 *  dedicated column, since that's the only place the distinction actually matters). */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to view your Garage 61 connection." });
  }

  const row = await context.env.DB.prepare(
    `SELECT garage61_slug as slug, refresh_token as refreshToken FROM garage61_oauth_tokens WHERE user_id = ?`
  )
    .bind(viewer.user!.id)
    .first<any>();

  if (!row) return json({ ok: true, connected: false });

  return json({
    ok: true,
    connected: true,
    garage61Slug: row.slug ?? null,
    connectionMethod: row.refreshToken ? "oauth" : "personal_token",
  });
}

export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to disconnect Garage 61." });
  }

  await context.env.DB.prepare(`DELETE FROM garage61_oauth_tokens WHERE user_id = ?`).bind(viewer.user!.id).run();

  return json({ ok: true });
}
