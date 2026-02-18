import { parseCookies } from "./cookies";
import { refreshTokens } from "./iracing";

type DB = D1Database;

type Env = {
  DB: DB;
  IRACING_CLIENT_ID: string;
  IRACING_CLIENT_SECRET: string;
  IRACING_REDIRECT_URI: string;
};

export type Viewer = {
  verified: boolean;
  user?: { id: string; iracingId: string; name: string };
  accessToken?: string;
};

const SESSION_COOKIE = "gr_session";

export async function getViewer(context: any): Promise<Viewer> {
  const { DB } = context.env as Env;
  const cookies = parseCookies(context.request);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return { verified: false };

  const now = new Date().toISOString();

  const sess = await DB.prepare(
    `SELECT s.id, s.user_id as userId, s.expires_at as expiresAt, u.iracing_member_id as iracingId, u.display_name as name
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`
  ).bind(sid).first<any>();

  if (!sess?.id) return { verified: false };
  if (sess.expiresAt <= now) {
    // expired -> cleanup
    await DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(sid).run();
    return { verified: false };
  }

  // touch last_seen_at (cheap)
  await DB.prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`).bind(now, sid).run();

  return {
    verified: true,
    user: { id: sess.userId, iracingId: String(sess.iracingId), name: String(sess.name) },
  };
}

export async function getValidAccessToken(context: any, userId: string): Promise<string> {
  const { DB, IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_REDIRECT_URI } = context.env as Env;
  const env = { IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_REDIRECT_URI };

  const row = await DB.prepare(
    `SELECT access_token as accessToken, refresh_token as refreshToken, access_expires_at as accessExpiresAt
     FROM oauth_tokens WHERE user_id = ?`
  ).bind(userId).first<any>();

  if (!row?.accessToken) throw new Error("No tokens for user");

  const nowMs = Date.now();
  const expMs = row.accessExpiresAt ? Date.parse(row.accessExpiresAt) : 0;

  // 30s safety buffer
  if (expMs && expMs - nowMs > 30_000) {
    return row.accessToken as string;
  }

  if (!row.refreshToken) throw new Error("Access expired and no refresh token");

  const refreshed = await refreshTokens(env, row.refreshToken);

  const accessExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 600) * 1000).toISOString();
  const updatedAt = new Date().toISOString();

  // IMPORTANT: refresh token may rotate; overwrite if provided
  await DB.prepare(
    `UPDATE oauth_tokens
     SET access_token = ?, refresh_token = ?, access_expires_at = ?, scope = ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(
    refreshed.access_token,
    refreshed.refresh_token ?? row.refreshToken,
    accessExpiresAt,
    refreshed.scope ?? null,
    updatedAt,
    userId
  ).run();

  return refreshed.access_token;
}
