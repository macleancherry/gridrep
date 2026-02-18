type Env = {
  IRACING_CLIENT_ID: string;
  IRACING_CLIENT_SECRET: string;
  IRACING_REDIRECT_URI: string;
};

const OAUTH_AUTHORIZE = "https://oauth.iracing.com/oauth2/authorize";
const OAUTH_TOKEN = "https://oauth.iracing.com/oauth2/token";
const DATA_BASE = "https://members-ng.iracing.com";

function base64UrlEncode(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
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

async function postForm(url: string, form: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token error ${res.status}: ${text}`);
  return JSON.parse(text);
}

export async function exchangeCodeForTokens(env: Env, code: string, codeVerifier: string): Promise<TokenResponse> {
  return postForm(OAUTH_TOKEN, {
    grant_type: "authorization_code",
    client_id: env.IRACING_CLIENT_ID,
    client_secret: env.IRACING_CLIENT_SECRET,
    code,
    redirect_uri: env.IRACING_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
}

export async function refreshTokens(env: Env, refreshToken: string): Promise<TokenResponse> {
  return postForm(OAUTH_TOKEN, {
    grant_type: "refresh_token",
    client_id: env.IRACING_CLIENT_ID,
    client_secret: env.IRACING_CLIENT_SECRET,
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
