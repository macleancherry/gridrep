type Env = {
  IRACING_CLIENT_ID: string;
  IRACING_CLIENT_SECRET: string;
  IRACING_REDIRECT_URI: string;
};

const OAUTH_AUTHORIZE = "https://oauth.iracing.com/oauth2/authorize";
const OAUTH_TOKEN = "https://oauth.iracing.com/oauth2/token";
const DATA_BASE = "https://members-ng.iracing.com";

/**
 * For PKCE verifier/challenge we need URL-safe base64 (no + / =).
 */
function base64UrlEncode(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
}

/**
 * iRacing OAuth token endpoint requires a "masked" client_secret:
 * base64( sha256( client_secret + normalized_client_id ) )
 * where normalized_client_id = client_id.trim().toLowerCase()
 *
 * IMPORTANT: This MUST be standard base64 (may include + / and =),
 * not URL-safe base64.
 */
async function maskClientSecret(env: Env): Promise<string> {
  const normalizedId = env.IRACING_CLIENT_ID.trim().toLowerCase();
  const toHash = `${env.IRACING_CLIENT_SECRET}${normalizedId}`;
  const digest = await sha256(toHash);
  const bytes = new Uint8Array(digest);

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  // Standard base64 output (length should be 44 chars for SHA-256)
  return btoa(binary);
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  // verifier: 43-128 chars, unreserved chars
  const rand = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(rand.buffer);
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("scope", args.scope ?? "iracing.auth");
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

class IRacingHttpError extends Error {
  status: number;
  raw: string;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, opts: { status: number; raw: string; code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "IRacingHttpError";
    this.status = opts.status;
    this.raw = opts.raw;
    this.code = opts.code;
    this.details = opts.details;
  }
}

class IRacingTokenError extends IRacingHttpError {
  error?: string;
  error_description?: string;

  constructor(
    message: string,
    opts: { status: number; raw: string; error?: string; error_description?: string; details?: Record<string, unknown> }
  ) {
    super(message, { status: opts.status, raw: opts.raw, code: "token_error", details: opts.details });
    this.name = "IRacingTokenError";
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
}

class IRacingScopeRequiredError extends IRacingHttpError {
  constructor(message: string, opts: { status: number; raw: string; details?: Record<string, unknown> }) {
    super(message, { status: opts.status, raw: opts.raw, code: "scope_required", details: opts.details });
    this.name = "IRacingScopeRequiredError";
  }
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * POST x-www-form-urlencoded and parse JSON.
 * If this is the OAuth token endpoint, we automatically mask client_secret.
 *
 * IMPORTANT: For token endpoint errors, we throw IRacingTokenError with structured fields:
 *   - status, error, error_description, raw
 * so callers can reliably detect invalid_grant/expired, etc.
 */
async function postForm(env: Env, url: string, form: Record<string, string>): Promise<any> {
  const isTokenEndpoint = url === OAUTH_TOKEN;

  if (isTokenEndpoint) {
    const id = env?.IRACING_CLIENT_ID;
    const secret = env?.IRACING_CLIENT_SECRET;
    const redirect = env?.IRACING_REDIRECT_URI;

    // Hard fail early if misconfigured (prevents hashing undefined)
    if (!id || !secret || !redirect) {
      console.error("Missing OAuth env vars", {
        hasClientId: !!id,
        hasClientSecret: !!secret,
        hasRedirectUri: !!redirect,
      });
      throw new Error("Server misconfigured: missing OAuth env vars");
    }

    const masked = await maskClientSecret(env);

    const payload: Record<string, string> = { ...form, client_id: id, client_secret: masked };
    const body = new URLSearchParams(payload).toString();

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await res.text();
    const parsed = tryParseJson(text) as TokenErrorShape | null;

    if (!res.ok) {
      // iRacing typically returns JSON like { error, error_description }
      const err = parsed ?? {};
      throw new IRacingTokenError(`Token error ${res.status}`, {
        status: res.status,
        raw: text,
        error: err.error,
        error_description: err.error_description,
        details: {
          // safe fields only
          has_error: Boolean(err.error),
          has_error_description: Boolean(err.error_description),
        },
      });
    }

    if (!parsed) {
      throw new IRacingTokenError(`Token error ${res.status}: non-JSON response`, {
        status: res.status,
        raw: text,
      });
    }

    return parsed;
  }

  // Non-token posts: unchanged, but throw structured error if non-OK
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new IRacingHttpError(`HTTP error ${res.status}`, { status: res.status, raw: text, code: "http_error" });
  }

  const parsed = tryParseJson(text);
  if (!parsed) {
    throw new IRacingHttpError(`HTTP error ${res.status}: non-JSON response`, {
      status: res.status,
      raw: text,
      code: "non_json",
    });
  }

  return parsed;
}

export async function exchangeCodeForTokens(env: Env, code: string, codeVerifier: string): Promise<TokenResponse> {
  return postForm(env, OAUTH_TOKEN, {
    grant_type: "authorization_code",
    client_id: env.IRACING_CLIENT_ID,
    // client_secret will be masked inside postForm()
    code,
    redirect_uri: env.IRACING_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
}

export async function refreshTokens(env: Env, refreshToken: string): Promise<TokenResponse> {
  return postForm(env, OAUTH_TOKEN, {
    grant_type: "refresh_token",
    client_id: env.IRACING_CLIENT_ID,
    // client_secret will be masked inside postForm()
    refresh_token: refreshToken,
  });
}

/**
 * iRacing data endpoints often return { link: "https://..." } pointing to signed S3 content.
 * We fetch the /data endpoint with Bearer, then follow link to get the real JSON.
 *
 * If the /data endpoint responds 401 with "iracing.auth scope is required", we throw IRacingScopeRequiredError.
 * Otherwise we throw IRacingHttpError with status + raw.
 */
export async function iracingDataGet<T>(path: string, accessToken: string): Promise<T> {
  const url = `${DATA_BASE}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const metaText = await res.text();

  if (!res.ok) {
    const parsed = tryParseJson(metaText);
    const message = (parsed?.message ?? parsed?.error ?? metaText ?? "").toString();

    // Specific known error:
    // {"error":"Unauthorized","message":"The iracing.auth scope is required for this request."}
    if (res.status === 401 && message.toLowerCase().includes("iracing.auth") && message.toLowerCase().includes("required")) {
      throw new IRacingScopeRequiredError("The iracing.auth scope is required for this request.", {
        status: res.status,
        raw: metaText,
        details: {
          path,
        },
      });
    }

    throw new IRacingHttpError(`iRacing data meta error ${res.status}`, {
      status: res.status,
      raw: metaText,
      code: "data_meta_error",
      details: { path },
    });
  }

  const meta = tryParseJson(metaText);
  if (!meta) {
    throw new IRacingHttpError("iRacing data meta error: non-JSON response", {
      status: res.status,
      raw: metaText,
      code: "data_meta_non_json",
      details: { path },
    });
  }

  // Some endpoints may return data directly, but most return { link }
  if (meta?.link) {
    const dataRes = await fetch(meta.link);
    const dataText = await dataRes.text();
    if (!dataRes.ok) {
      throw new IRacingHttpError(`iRacing data link error ${dataRes.status}`, {
        status: dataRes.status,
        raw: dataText,
        code: "data_link_error",
        details: { path },
      });
    }

    const dataParsed = tryParseJson(dataText);
    if (!dataParsed) {
      throw new IRacingHttpError("iRacing data link error: non-JSON response", {
        status: dataRes.status,
        raw: dataText,
        code: "data_link_non_json",
        details: { path },
      });
    }

    return dataParsed as T;
  }

  return meta as T;
}
