// Garage 61 OAuth2 (standard Authorization Code Grant, RFC 6749 - no client_secret
// masking quirk like iRacing's) + a thin GET wrapper for the /api/v1 REST API.
//
// Reference: https://garage61.net/api/openapi/v1.json (fetched and inspected directly,
// since the /developer docs page is a client-rendered SPA with no server-rendered
// content - see PR description for how this was retrieved).

type Env = {
  GARAGE61_CLIENT_ID: string;
  GARAGE61_CLIENT_SECRET: string;
  GARAGE61_REDIRECT_URI: string;
};

const OAUTH_AUTHORIZE = "https://garage61.net/app/account/oauth";
const OAUTH_TOKEN = "https://garage61.net/api/oauth/token";
const API_BASE = "https://garage61.net/api/v1";

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", args.state);
  u.searchParams.set("scope", args.scope ?? "driving_data");
  return u.toString();
}

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

type TokenErrorShape = {
  error?: string;
  error_description?: string;
};

export class Garage61HttpError extends Error {
  status: number;
  raw: string;
  code?: string;

  constructor(message: string, opts: { status: number; raw: string; code?: string }) {
    super(message);
    this.name = "Garage61HttpError";
    this.status = opts.status;
    this.raw = opts.raw;
    this.code = opts.code;
  }
}

export class Garage61TokenError extends Garage61HttpError {
  error?: string;
  error_description?: string;

  constructor(message: string, opts: { status: number; raw: string; error?: string; error_description?: string }) {
    super(message, { status: opts.status, raw: opts.raw, code: "token_error" });
    this.name = "Garage61TokenError";
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postForm(env: Env, form: Record<string, string>): Promise<TokenResponse> {
  const { GARAGE61_CLIENT_ID, GARAGE61_CLIENT_SECRET, GARAGE61_REDIRECT_URI } = env;
  if (!GARAGE61_CLIENT_ID || !GARAGE61_CLIENT_SECRET || !GARAGE61_REDIRECT_URI) {
    console.error("Missing Garage 61 OAuth env vars", {
      hasClientId: !!GARAGE61_CLIENT_ID,
      hasClientSecret: !!GARAGE61_CLIENT_SECRET,
      hasRedirectUri: !!GARAGE61_REDIRECT_URI,
    });
    throw new Error("Server misconfigured: missing Garage 61 OAuth env vars");
  }

  const body = new URLSearchParams({
    ...form,
    client_id: GARAGE61_CLIENT_ID,
    client_secret: GARAGE61_CLIENT_SECRET,
  }).toString();

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  const parsed = tryParseJson(text) as (TokenResponse & TokenErrorShape) | null;

  if (!res.ok) {
    const err = parsed ?? {};
    throw new Garage61TokenError(`Token error ${res.status}`, {
      status: res.status,
      raw: text,
      error: err.error,
      error_description: err.error_description,
    });
  }

  if (!parsed?.access_token) {
    throw new Garage61TokenError(`Token error ${res.status}: non-JSON or missing access_token`, {
      status: res.status,
      raw: text,
    });
  }

  return parsed;
}

export async function exchangeCodeForTokens(env: Env, code: string): Promise<TokenResponse> {
  return postForm(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: env.GARAGE61_REDIRECT_URI,
  });
}

export async function refreshTokens(env: Env, refreshToken: string): Promise<TokenResponse> {
  return postForm(env, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/**
 * GET against the Garage 61 REST API (https://garage61.net/api/v1/...), Bearer-authed.
 * Unlike iRacing's /data endpoints, Garage 61 returns the real payload directly - no
 * link-following indirection.
 */
export async function garage61ApiGet<T>(path: string, accessToken: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();

  if (!res.ok) {
    throw new Garage61HttpError(`HTTP error ${res.status}`, { status: res.status, raw: text, code: "http_error" });
  }

  const parsed = tryParseJson(text);
  if (parsed === null) {
    throw new Garage61HttpError(`HTTP error ${res.status}: non-JSON response`, {
      status: res.status,
      raw: text,
      code: "non_json",
    });
  }

  return parsed as T;
}

export type Garage61Me = {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
  nickName?: string;
  apiPermissions?: string[];
};
