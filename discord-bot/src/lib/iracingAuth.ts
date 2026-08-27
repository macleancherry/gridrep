// The bot looks up arbitrary drivers/series on iRacing's Data API, which
// requires *some* authenticated member's bearer token for every request -
// not per-Discord-user consent. We reuse GridRep's existing OAuth PKCE
// client (same code the web app uses to authenticate its own users) but
// point it at a single "service" iRacing account belonging to whoever
// self-hosts the bot. That account's refresh token is stored once (see
// discord-bot/README.md for the one-time setup) and kept fresh here.
import { refreshTokens, iracingDataGet, type TokenResponse } from "../../../functions/_lib/iracing.ts";

export type IracingEnv = {
  IRACING_CLIENT_ID: string;
  IRACING_CLIENT_SECRET: string;
  IRACING_REDIRECT_URI: string;
};

export type BotEnv = IracingEnv & {
  DB: D1Database;
};

const REFRESH_SKEW_MS = 60_000;

type ServiceTokenRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

async function loadTokenRow(db: D1Database): Promise<ServiceTokenRow | null> {
  const row = await db
    .prepare("SELECT access_token, refresh_token, expires_at FROM bot_service_tokens WHERE id = 1")
    .first<ServiceTokenRow>();
  return row ?? null;
}

async function saveTokenRow(db: D1Database, tokens: TokenResponse, previousRefreshToken: string): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO bot_service_tokens (id, access_token, refresh_token, expires_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`
    )
    .bind(tokens.access_token, tokens.refresh_token ?? previousRefreshToken, expiresAt)
    .run();
}

/**
 * Seed or replace the stored service-account tokens. Used by the one-time
 * setup flow after the self-hoster completes the iRacing OAuth consent.
 */
export async function storeInitialServiceTokens(db: D1Database, tokens: TokenResponse): Promise<void> {
  await saveTokenRow(db, tokens, tokens.refresh_token ?? "");
}

export async function getValidServiceAccessToken(env: BotEnv): Promise<string> {
  const row = await loadTokenRow(env.DB);
  if (!row) {
    throw new Error(
      "No iRacing service account configured. Complete the one-time setup in discord-bot/README.md."
    );
  }

  const expiresAt = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return row.access_token;
  }

  const refreshed = await refreshTokens(env, row.refresh_token);
  await saveTokenRow(env.DB, refreshed, row.refresh_token);
  return refreshed.access_token;
}

/** Fetch a Data API path, authenticated as the bot's service account. */
export async function iracingGet<T>(env: BotEnv, path: string): Promise<T> {
  const accessToken = await getValidServiceAccessToken(env);
  return iracingDataGet<T>(path, accessToken);
}
