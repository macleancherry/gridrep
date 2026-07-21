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

export type Garage61Account = {
  platform: string;
  id: string;
  name: string;
};

/**
 * GET /me/accounts - confirmed live: for a connected user this includes their linked
 * iRacing platform account with its real iRacing cust_id directly on `id`
 * ({"platform":"iracing","id":"1291454","name":"Mac Cherry",...}). This is the only
 * place the Garage 61 API exposes that mapping - used once at connect time (callback.ts)
 * to populate garage61_oauth_tokens.iracing_cust_id.
 */
export async function fetchGarage61Accounts(accessToken: string): Promise<{ items: Garage61Account[] }> {
  return garage61ApiGet<{ items: Garage61Account[] }>("/me/accounts", accessToken);
}

export type Garage61Track = {
  id: number;
  name: string;
  variant: string;
  platform: string;
  platform_id: string;
};

export async function fetchGarage61Tracks(accessToken: string): Promise<{ items: Garage61Track[] }> {
  return garage61ApiGet<{ items: Garage61Track[] }>("/tracks", accessToken);
}

export type Garage61Lap = {
  id: string;
  driver: { id: string; slug: string; firstName: string; lastName: string };
  car: { id: number; name: string; platform: string; platform_id: string };
  track: { id: number; name: string; variant: string; platform: string; platform_id: string };
  startTime: string;
  lapNumber: number;
  lapTime: number;
  clean: boolean;
  incomplete: boolean;
  pitlane: boolean;
  fuelLevel: number | null;
  fuelUsed: number | null;
  fuelAdded: number | null;
};

export type Garage61LapSearchParams = {
  tracks: number[];
  drivers?: Array<"me" | "following">;
  teams?: string[];
  extraDrivers?: string[];
  unclean?: boolean;
  group?: "driver" | "driver-car" | "none";
  limit?: number;
  offset?: number;
};

export type Garage61Team = {
  id: string;
  name: string;
  slug: string;
};

export type Garage61TeamMember = {
  slug: string;
  firstName: string;
  lastName: string;
  accounts?: Garage61Account[];
};

export type Garage61TeamDetail = Garage61Team & {
  members: Garage61TeamMember[];
};

/**
 * GET /teams - confirmed live: lists the "joined" teams for the calling token's owner
 * (Garage 61's own OpenAPI spec's wording - there's no admin/owner distinction anywhere in
 * this API's data model, so this is every team the token owner belongs to at all).
 */
export async function fetchGarage61Teams(accessToken: string): Promise<{ items: Garage61Team[] }> {
  return garage61ApiGet<{ items: Garage61Team[] }>("/teams", accessToken);
}

/**
 * GET /teams/:teamId - confirmed live: returns the full member roster including each
 * member's real linked iRacing accounts[] (with cust_id), for any team the token owner has
 * joined - works identically whether the caller is an admin or just a regular member,
 * since Garage 61 has no role/admin concept on team membership at all.
 */
export async function fetchGarage61TeamDetail(accessToken: string, teamId: string): Promise<Garage61TeamDetail> {
  return garage61ApiGet<Garage61TeamDetail>(`/teams/${encodeURIComponent(teamId)}`, accessToken);
}

/**
 * GET /laps - confirmed live against a real Spa Endurance session. `tracks` is the only
 * required filter. Omitting `drivers`/`teams`/`extraDrivers` entirely makes the API default
 * to "driving data visible to the authenticated user" - confirmed this already includes the
 * caller's teammates, not just their own laps, which is what the team-wide name-matched fuel
 * lookup in plannerGarage61Fuel.ts relies on. Confirmed live: `teams` filters correctly, but
 * only by the team's *slug* (e.g. "ignium-motorsport") - passing its opaque id instead is
 * silently ignored and falls through to the unscoped default. `limit`'s own real API default
 * and maximum are both 1000 (confirmed against the OpenAPI spec), not the 200 this wrapper
 * used to default to - that mismatch is what let a busy shared track silently bury a driver's
 * own laps past the end of a single page (see plannerGarage61Fuel.ts's pagination loop).
 */
export async function fetchGarage61Laps(
  accessToken: string,
  params: Garage61LapSearchParams
): Promise<{ items: Garage61Lap[]; total: number }> {
  const q = new URLSearchParams();
  q.set("tracks", params.tracks.join(","));
  if (params.drivers?.length) q.set("drivers", params.drivers.join(","));
  if (params.teams?.length) q.set("teams", params.teams.join(","));
  if (params.extraDrivers?.length) q.set("extraDrivers", params.extraDrivers.join(","));
  q.set("unclean", params.unclean ? "true" : "false");
  q.set("group", params.group ?? "none");
  q.set("limit", String(params.limit ?? 1000));
  if (params.offset) q.set("offset", String(params.offset));

  return garage61ApiGet<{ items: Garage61Lap[]; total: number }>(`/laps?${q.toString()}`, accessToken);
}
