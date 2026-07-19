import { parseCookies } from "./cookies";
import { refreshTokens } from "./iracing";
import { refreshTokens as refreshGarage61Tokens } from "./garage61";

type DB = D1Database;

type Env = {
  DB: DB;
  IRACING_CLIENT_ID: string;
  IRACING_CLIENT_SECRET: string;
  IRACING_REDIRECT_URI: string;
};

type Garage61Env = {
  DB: DB;
  GARAGE61_CLIENT_ID: string;
  GARAGE61_CLIENT_SECRET: string;
  GARAGE61_REDIRECT_URI: string;
};

export type Viewer = {
  verified: boolean;
  user?: { id: string; iracingId: string; name: string };
  accessToken?: string;
};

const SESSION_COOKIE = "gr_session";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  // Never include tokens in logs
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

function isFiniteDateMs(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

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
  )
    .bind(sid)
    .first<any>();

  if (!sess?.id) return { verified: false };

  // expiresAt stored as ISO string; lexicographic compare works for ISO8601
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

/**
 * Returns a valid iRacing access token for the user.
 *
 * Throws AuthError with code "auth_required" when:
 * - no tokens exist
 * - access token expired and no refresh token exists
 * - refresh fails
 *
 * Callers can catch (err.code === "auth_required") to prompt re-verify.
 */
export async function getValidAccessToken(context: any, userId: string, debugId?: string): Promise<string> {
  const localDebugId = debugId ?? crypto.randomUUID();

  const { DB, IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_REDIRECT_URI } = context.env as Env;
  const env = { IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_REDIRECT_URI };

  const row = await DB.prepare(
    `SELECT access_token as accessToken, refresh_token as refreshToken, access_expires_at as accessExpiresAt, scope as scope
     FROM oauth_tokens WHERE user_id = ?`
  )
    .bind(userId)
    .first<any>();

  if (!row?.accessToken) {
    safeLog("warn", localDebugId, "auth.getValidAccessToken.no_tokens", { userId });
    throw new AuthError("auth_required", "No tokens for user");
  }

  const nowMs = Date.now();

  let expMs = 0;
  if (row.accessExpiresAt) {
    const parsed = Date.parse(row.accessExpiresAt);
    expMs = Number.isFinite(parsed) ? parsed : 0;
  }

  // 30s safety buffer
  if (isFiniteDateMs(expMs) && expMs - nowMs > 30_000) {
    return row.accessToken as string;
  }

  if (!row.refreshToken) {
    safeLog("warn", localDebugId, "auth.getValidAccessToken.no_refresh_token", { userId });
    throw new AuthError("auth_required", "Access expired and no refresh token");
  }

  safeLog("log", localDebugId, "auth.getValidAccessToken.refreshing", { userId });

  let refreshed: any;
  try {
    refreshed = await refreshTokens(env, row.refreshToken);
  } catch (err: any) {
    safeLog("warn", localDebugId, "auth.getValidAccessToken.refresh_failed", {
      userId,
      name: err?.name ?? null,
      code: err?.code ?? err?.error ?? null,
      status: err?.status ?? null,
      message: err?.message ?? String(err),
      error_description: err?.error_description ?? null,
    });
    throw new AuthError("auth_required", "Token refresh failed");
  }

  const accessExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 600) * 1000).toISOString();
  const updatedAt = new Date().toISOString();

  // IMPORTANT:
  // - refresh token may rotate; overwrite if provided
  // - scope is sometimes omitted on refresh; do NOT overwrite to null in that case
  const nextRefreshToken = refreshed.refresh_token ?? row.refreshToken;
  const nextScope =
    typeof refreshed.scope === "string" && refreshed.scope.trim()
      ? refreshed.scope
      : (typeof row.scope === "string" && row.scope.trim() ? row.scope : null);

  await DB.prepare(
    `UPDATE oauth_tokens
     SET access_token = ?, refresh_token = ?, access_expires_at = ?, scope = ?, updated_at = ?
     WHERE user_id = ?`
  )
    .bind(refreshed.access_token, nextRefreshToken, accessExpiresAt, nextScope, updatedAt, userId)
    .run();

  safeLog("log", localDebugId, "auth.getValidAccessToken.refresh_ok", {
    userId,
    expires_in: refreshed.expires_in ?? null,
    has_scope: Boolean(refreshed?.scope),
  });

  return refreshed.access_token;
}

/**
 * Returns a valid Garage 61 access token for the user, or null if they haven't connected
 * Garage 61 (this is an optional secondary link, unlike the required iRacing sign-in - so
 * callers should treat null as "not connected" and degrade gracefully, not as an error).
 *
 * Throws AuthError with code "auth_required" only when a connection exists but its refresh
 * token has expired/been revoked - callers should prompt a reconnect in that case.
 */
export async function getValidGarage61AccessToken(
  context: any,
  userId: string,
  debugId?: string
): Promise<string | null> {
  const localDebugId = debugId ?? crypto.randomUUID();

  const { DB, GARAGE61_CLIENT_ID, GARAGE61_CLIENT_SECRET, GARAGE61_REDIRECT_URI } = context.env as Garage61Env;
  const env = { GARAGE61_CLIENT_ID, GARAGE61_CLIENT_SECRET, GARAGE61_REDIRECT_URI };

  const row = await DB.prepare(
    `SELECT access_token as accessToken, refresh_token as refreshToken, access_expires_at as accessExpiresAt
     FROM garage61_oauth_tokens WHERE user_id = ?`
  )
    .bind(userId)
    .first<any>();

  if (!row?.accessToken) return null;

  const nowMs = Date.now();

  let expMs = 0;
  if (row.accessExpiresAt) {
    const parsed = Date.parse(row.accessExpiresAt);
    expMs = Number.isFinite(parsed) ? parsed : 0;
  }

  if (isFiniteDateMs(expMs) && expMs - nowMs > 30_000) {
    return row.accessToken as string;
  }

  if (!row.refreshToken) {
    safeLog("warn", localDebugId, "auth.getValidGarage61AccessToken.no_refresh_token", { userId });
    throw new AuthError("auth_required", "Garage 61 access expired and no refresh token");
  }

  safeLog("log", localDebugId, "auth.getValidGarage61AccessToken.refreshing", { userId });

  let refreshed: any;
  try {
    refreshed = await refreshGarage61Tokens(env, row.refreshToken);
  } catch (err: any) {
    safeLog("warn", localDebugId, "auth.getValidGarage61AccessToken.refresh_failed", {
      userId,
      name: err?.name ?? null,
      code: err?.code ?? err?.error ?? null,
      status: err?.status ?? null,
      message: err?.message ?? String(err),
      error_description: err?.error_description ?? null,
    });
    throw new AuthError("auth_required", "Garage 61 token refresh failed");
  }

  const accessExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 600) * 1000).toISOString();
  const updatedAt = new Date().toISOString();
  const nextRefreshToken = refreshed.refresh_token ?? row.refreshToken;

  await DB.prepare(
    `UPDATE garage61_oauth_tokens
     SET access_token = ?, refresh_token = ?, access_expires_at = ?, updated_at = ?
     WHERE user_id = ?`
  )
    .bind(refreshed.access_token, nextRefreshToken, accessExpiresAt, updatedAt, userId)
    .run();

  safeLog("log", localDebugId, "auth.getValidGarage61AccessToken.refresh_ok", {
    userId,
    expires_in: refreshed.expires_in ?? null,
  });

  return refreshed.access_token;
}
