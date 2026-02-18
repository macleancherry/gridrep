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

/**
 * POST x-www-form-urlencoded and parse JSON.
 * If this is the OAuth token endpoint, we automatically mask client_secret.
 */
async function postForm(env: Env, url: string, form: Record<string, string>): Promise<any> {
  const isTokenEndpoint = url === OAUTH_TOKEN;

  const payload: Record<string, string> = { ...form };

  if (isTokenEndpoint) {
    // Replace raw client_secret with masked secret required by iRacing
    payload.client_secret = await maskClientSecret(env);
  }

  const body = new URLSearchParams(payload).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Token error ${res.status}: ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Token error ${res.status}: non-JSON response: ${text}`);
  }
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
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
 */
export async function iracingDataGet<T>(path: string, accessToken: string): Promise<T> {
  const url = `${DATA_BASE}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const metaText = await res.text();
  if (!res.ok) throw new Error(`iRacing data meta error ${res.status}: ${metaText}`);
  const meta = JSON.parse(metaText);

  // Some endpoints may return data directly, but most return { link }
  if (meta?.link) {
    const dataRes = await fetch(meta.link);
    const dataText = await dataRes.text();
    if (!dataRes.ok) throw new Error(`iRacing data link error ${dataRes.status}: ${dataText}`);
    return JSON.parse(dataText) as T;
  }

  return meta as T;
}
