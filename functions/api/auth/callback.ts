import { parseCookies, serializeCookie, clearCookie } from "../../_lib/cookies";
import { exchangeCodeForTokens, iracingDataGet } from "../../_lib/iracing";

type MemberRecentRaces = any; // we parse defensively

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  // Never include tokens in logs
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

function parseScopeSet(scope?: string | null): Set<string> {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean));
}

function hasRequiredScope(scope?: string | null): boolean {
  // Requirement per handover
  return parseScopeSet(scope).has("iracing.auth");
}

function isExpiredOrUsedGrant(err: any): boolean {
  const e = (err?.error ?? "").toString().toLowerCase();
  const d = (err?.error_description ?? "").toString().toLowerCase();

  // Seen in logs: {"error":"invalid_grant","error_description":"expired"}
  // Also handle “used twice” / “invalid” style descriptions.
  return e === "invalid_grant" && (d.includes("expired") || d.includes("used") || d.includes("invalid"));
}

// Append verified=1 safely to returnTo so the frontend can auto-sync once
function appendQueryParam(url: string, key: string, value: string, origin: string) {
  const isAbsolute = /^https?:\/\//i.test(url);
  const u = new URL(url, origin);
  u.searchParams.set(key, value);
  return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Best-effort: try to fetch a member display name from iRacing so the UI can
 * prompt users to "search your name" instead of showing "Driver <id>".
 *
 * This must never break auth if it fails.
 */
async function fetchMemberDisplayName(accessToken: string, custId: string): Promise<string | null> {
  const tryPaths = [
    // Different tenants / wrappers expose different shapes. Try a few.
    `/data/member/info?cust_ids=${encodeURIComponent(custId)}`,
    `/data/member/get?cust_ids=${encodeURIComponent(custId)}`,
    `/data/member/summary?cust_id=${encodeURIComponent(custId)}`,
  ];

  for (const path of tryPaths) {
    try {
      const data: any = await iracingDataGet<any>(path, accessToken);

      // Common shapes
      const member =
        (Array.isArray(data?.members) && data.members[0]) ||
        (Array.isArray(data?.data) && data.data[0]) ||
        data?.member ||
        data;

      const name =
        member?.display_name ??
        member?.name ??
        member?.member_display_name ??
        member?.customer_display_name;

      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      // ignore and try next endpoint
    }
  }

  return null;
}

export async function onRequestGet(context: any) {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;
  const reqUrl = new URL(context.request.url);

  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");

  if (!code || !state) {
    safeLog("warn", debugId, "auth.callback.missing_code_or_state", {
      hasCode: Boolean(code),
      hasState: Boolean(state),
    });
    return new Response("Missing code/state", { status: 400 });
  }

  const cookies = parseCookies(context.request);
  const oauthRaw = cookies["gr_oauth"];

  safeLog("log", debugId, "auth.callback.start", {
    hasOauthCookie: Boolean(oauthRaw),
    ua: context.request.headers.get("user-agent") ?? undefined,
  });

  if (!oauthRaw) return new Response("Missing OAuth cookie", { status: 400 });

  let oauth: any;
  try {
    oauth = JSON.parse(oauthRaw);
  } catch {
    safeLog("warn", debugId, "auth.callback.bad_oauth_cookie_json");
    return new Response("Bad OAuth cookie", { status: 400 });
  }

  if (oauth.state !== state) {
    safeLog("warn", debugId, "auth.callback.state_mismatch", {
      expected: oauth.state ?? null,
      got: state,
    });
    return new Response("State mismatch", { status: 400 });
  }

  // Exchange code -> tokens
  let token: any;
  try {
    token = await exchangeCodeForTokens(
      {
        IRACING_CLIENT_ID: context.env.IRACING_CLIENT_ID,
        IRACING_CLIENT_SECRET: context.env.IRACING_CLIENT_SECRET,
        IRACING_REDIRECT_URI: context.env.IRACING_REDIRECT_URI,
      },
      code,
      oauth.verifier
    );
  } catch (err: any) {
    safeLog("warn", debugId, "auth.callback.token_exchange_failed", {
      error: err?.error ?? null,
      error_description: err?.error_description ?? null,
      message: err?.message ?? null,
    });

    // If the auth code expired/was already used, restart auth automatically
    if (isExpiredOrUsedGrant(err)) {
      const returnTo = typeof oauth.returnTo === "string" ? oauth.returnTo : "/";
      const headers = new Headers();
      headers.append("Set-Cookie", clearCookie("gr_oauth"));
      headers.set("Location", `/api/auth/start?returnTo=${encodeURIComponent(returnTo)}`);
      headers.set("X-GridRep-Debug-Id", debugId);
      return new Response(null, { status: 302, headers });
    }

    return new Response(
      JSON.stringify({
        error: "token_exchange_failed",
        message: "Token exchange failed. Please try verifying again.",
        debugId,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  safeLog("log", debugId, "auth.callback.token_exchange_ok", {
    scope: token?.scope ?? null,
    expires_in: token?.expires_in ?? null,
    has_access_token: Boolean(token?.access_token),
    has_refresh_token: Boolean(token?.refresh_token),
  });

  // Validate required scope immediately
  if (!hasRequiredScope(token?.scope)) {
    safeLog("warn", debugId, "auth.callback.missing_required_scope", {
      scope: token?.scope ?? null,
    });

    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.append("Set-Cookie", clearCookie("gr_oauth"));
    headers.set("X-GridRep-Debug-Id", debugId);

    return new Response(
      JSON.stringify({
        error: "missing_required_scope",
        message:
          "Your iRacing account did not grant the required scope (iracing.auth). Please verify again. If it still fails, ensure your iRacing subscription is active and your account is eligible for data access.",
        debugId,
        scope: token?.scope ?? null,
      }),
      { status: 403, headers }
    );
  }

  const accessExpiresAt = new Date(Date.now() + (token.expires_in ?? 600) * 1000).toISOString();

  // Identify current member via member_recent_races (authed “me”)
  // Note: /data endpoints often return { link }, which we follow in iracingDataGet()
  let recent: MemberRecentRaces;
  try {
    recent = await iracingDataGet<MemberRecentRaces>("/data/stats/member_recent_races", token.access_token);
  } catch (err: any) {
    safeLog("error", debugId, "auth.callback.me_lookup_failed", {
      status: err?.status ?? null,
      message: err?.message ?? String(err),
    });

    return new Response(
      JSON.stringify({
        error: "me_lookup_failed",
        message: "Could not verify your iRacing account. Please try verifying again.",
        debugId,
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  // Extract member identity defensively (schema varies by wrapper)
  const identity = extractIdentity(recent);
  if (!identity?.iracingId) {
    safeLog("error", debugId, "auth.callback.identity_missing");
    return new Response("Could not determine iRacing identity", { status: 500 });
  }

  // Best-effort: fetch a better display name so users can "search your name"
  try {
    const betterName = await fetchMemberDisplayName(token.access_token, String(identity.iracingId));
    if (betterName) {
      identity.name = betterName;
      safeLog("log", debugId, "auth.callback.display_name_enriched", { name: betterName });
    }
  } catch {
    // never fail auth for this
  }

  safeLog("log", debugId, "auth.callback.identity_ok", { iracingId: identity.iracingId });

  const now = new Date().toISOString();

  // Upsert user by iracing_member_id
  const existing = await DB.prepare(`SELECT id FROM users WHERE iracing_member_id = ?`)
    .bind(identity.iracingId)
    .first<any>();

  const userId = existing?.id ?? crypto.randomUUID();

  if (!existing?.id) {
    await DB.prepare(`INSERT INTO users (id, iracing_member_id, display_name, created_at) VALUES (?, ?, ?, ?)`)
      .bind(userId, String(identity.iracingId), identity.name ?? `Driver ${identity.iracingId}`, now)
      .run();
  } else {
    // keep user display name fresh
    await DB.prepare(`UPDATE users SET display_name = ? WHERE id = ?`)
      .bind(identity.name ?? `Driver ${identity.iracingId}`, userId)
      .run();
  }

  // Store tokens
  await DB.prepare(
    `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, access_expires_at, refresh_expires_at, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token=excluded.access_token,
       refresh_token=excluded.refresh_token,
       access_expires_at=excluded.access_expires_at,
       refresh_expires_at=excluded.refresh_expires_at,
       scope=excluded.scope,
       updated_at=excluded.updated_at`
  )
    .bind(
      userId,
      token.access_token,
      token.refresh_token ?? null,
      accessExpiresAt,
      null,
      token.scope ?? null,
      now
    )
    .run();

  // Create GridRep auth session (30 days)
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(sessionId, userId, now, expiresAt, now)
    .run();

  const sessionCookie = serializeCookie("gr_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", clearCookie("gr_oauth"));
  headers.set("X-GridRep-Debug-Id", debugId);

  const returnTo = typeof oauth.returnTo === "string" ? oauth.returnTo : "/";
  const redirectTo = appendQueryParam(returnTo, "verified", "1", reqUrl.origin);
  headers.set("Location", redirectTo);

  return new Response(null, { status: 302, headers });
}

function extractIdentity(recent: any): { iracingId?: string; name?: string } {
  // Try common patterns
  if (recent?.cust_id) return { iracingId: String(recent.cust_id), name: recent.display_name ?? recent.name };
  if (recent?.member?.cust_id)
    return { iracingId: String(recent.member.cust_id), name: recent.member.display_name };

  // Many shapes have "races" or "results" arrays
  const arr = recent?.races ?? recent?.results ?? recent?.recent_races ?? recent?.data ?? [];

  if (Array.isArray(arr) && arr.length) {
    const r = arr[0];
    const id = r?.cust_id ?? r?.member_id ?? r?.driver_id ?? r?.driver?.cust_id;
    const name = r?.display_name ?? r?.driver_name ?? r?.name ?? r?.driver?.display_name;
    if (id) return { iracingId: String(id), name };
  }

  return {};
}
