import { parseCookies, clearCookie } from "../../../_lib/cookies";
import { exchangeCodeForTokens, garage61ApiGet, fetchGarage61Accounts, type Garage61Me } from "../../../_lib/garage61";
import { getViewer } from "../../../_lib/auth";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  // Never include tokens in logs
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

function appendQueryParam(url: string, key: string, value: string, origin: string) {
  const isAbsolute = /^https?:\/\//i.test(url);
  const u = new URL(url, origin);
  u.searchParams.set(key, value);
  return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

export async function onRequestGet(context: any) {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;
  const reqUrl = new URL(context.request.url);

  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");

  if (!code || !state) {
    safeLog("warn", debugId, "auth.garage61.callback.missing_code_or_state", {
      hasCode: Boolean(code),
      hasState: Boolean(state),
    });
    return new Response("Missing code/state", { status: 400 });
  }

  const cookies = parseCookies(context.request);
  const oauthRaw = cookies["gr_g61_oauth"];
  if (!oauthRaw) return new Response("Missing OAuth cookie", { status: 400 });

  let oauth: any;
  try {
    oauth = JSON.parse(oauthRaw);
  } catch {
    safeLog("warn", debugId, "auth.garage61.callback.bad_oauth_cookie_json");
    return new Response("Bad OAuth cookie", { status: 400 });
  }

  if (oauth.state !== state) {
    safeLog("warn", debugId, "auth.garage61.callback.state_mismatch", {
      expected: oauth.state ?? null,
      got: state,
    });
    return new Response("State mismatch", { status: 400 });
  }

  // Garage 61 is linked to an existing gridrep session, not a login mechanism itself.
  const viewer = await getViewer(context);
  if (!viewer.verified || !viewer.user) {
    safeLog("warn", debugId, "auth.garage61.callback.no_gridrep_session");
    const headers = new Headers();
    headers.append("Set-Cookie", clearCookie("gr_g61_oauth"));
    headers.set("X-GridRep-Debug-Id", debugId);
    return new Response("Your gridrep session expired mid-connect. Please sign in and try again.", {
      status: 401,
      headers,
    });
  }

  let token: any;
  try {
    token = await exchangeCodeForTokens(
      {
        GARAGE61_CLIENT_ID: context.env.GARAGE61_CLIENT_ID,
        GARAGE61_CLIENT_SECRET: context.env.GARAGE61_CLIENT_SECRET,
        GARAGE61_REDIRECT_URI: context.env.GARAGE61_REDIRECT_URI,
      },
      code
    );
  } catch (err: any) {
    safeLog("warn", debugId, "auth.garage61.callback.token_exchange_failed", {
      error: err?.error ?? null,
      error_description: err?.error_description ?? null,
      message: err?.message ?? null,
    });

    return new Response(
      JSON.stringify({
        error: "token_exchange_failed",
        message: "Garage 61 token exchange failed. Please try connecting again.",
        debugId,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  safeLog("log", debugId, "auth.garage61.callback.token_exchange_ok", {
    scope: token?.scope ?? null,
    expires_in: token?.expires_in ?? null,
    has_access_token: Boolean(token?.access_token),
    has_refresh_token: Boolean(token?.refresh_token),
  });

  let me: Garage61Me;
  try {
    me = await garage61ApiGet<Garage61Me>("/me", token.access_token);
  } catch (err: any) {
    safeLog("error", debugId, "auth.garage61.callback.me_lookup_failed", {
      status: err?.status ?? null,
      message: err?.message ?? String(err),
    });

    return new Response(
      JSON.stringify({
        error: "me_lookup_failed",
        message: "Could not verify your Garage 61 account. Please try connecting again.",
        debugId,
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!me?.id) {
    safeLog("error", debugId, "auth.garage61.callback.identity_missing");
    return new Response("Could not determine Garage 61 identity", { status: 500 });
  }

  // Confirmed live: /me/accounts carries the connecting user's own linked iRacing cust_id
  // directly ({"platform":"iracing","id":"<cust_id>",...}) - this is the only place the
  // Garage 61 API exposes that mapping, so it's captured once here rather than re-fetched
  // on every driver-profile computation. Best-effort: a driver who hasn't linked iRacing
  // inside Garage 61 itself (or an API hiccup) shouldn't block the account connection.
  let iracingCustId: string | null = null;
  try {
    const accounts = await fetchGarage61Accounts(token.access_token);
    const iracingAccount = (accounts.items ?? []).find((a) => a.platform === "iracing");
    iracingCustId = iracingAccount?.id ?? null;
  } catch (err: any) {
    safeLog("warn", debugId, "auth.garage61.callback.accounts_lookup_failed", {
      status: err?.status ?? null,
      message: err?.message ?? String(err),
    });
  }

  const now = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + (token.expires_in ?? 600) * 1000).toISOString();

  await DB.prepare(
    `INSERT INTO garage61_oauth_tokens
       (user_id, garage61_user_id, garage61_slug, access_token, refresh_token, access_expires_at, scope, iracing_cust_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       garage61_user_id=excluded.garage61_user_id,
       garage61_slug=excluded.garage61_slug,
       access_token=excluded.access_token,
       refresh_token=excluded.refresh_token,
       access_expires_at=excluded.access_expires_at,
       scope=excluded.scope,
       iracing_cust_id=COALESCE(excluded.iracing_cust_id, garage61_oauth_tokens.iracing_cust_id),
       updated_at=excluded.updated_at`
  )
    .bind(
      viewer.user.id,
      me.id,
      me.slug ?? null,
      token.access_token,
      token.refresh_token ?? null,
      accessExpiresAt,
      token.scope ?? null,
      iracingCustId,
      now
    )
    .run();

  safeLog("log", debugId, "auth.garage61.callback.linked", {
    userId: viewer.user.id,
    garage61UserId: me.id,
    iracingCustId,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie("gr_g61_oauth"));
  headers.set("X-GridRep-Debug-Id", debugId);

  const returnTo = typeof oauth.returnTo === "string" ? oauth.returnTo : "/race-planner";
  const redirectTo = appendQueryParam(returnTo, "garage61", "connected", reqUrl.origin);
  headers.set("Location", redirectTo);

  return new Response(null, { status: 302, headers });
}
