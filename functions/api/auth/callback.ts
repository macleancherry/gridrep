import { parseCookies, serializeCookie, clearCookie } from "../../_lib/cookies";
import { exchangeCodeForTokens, iracingDataGet } from "../../_lib/iracing";

type MemberRecentRaces = any; // we parse defensively

export async function onRequestGet(context: any) {
  const { DB } = context.env;
  const reqUrl = new URL(context.request.url);

  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");

  if (!code || !state) return new Response("Missing code/state", { status: 400 });

  const cookies = parseCookies(context.request);
  const oauthRaw = cookies["gr_oauth"];
  if (!oauthRaw) return new Response("Missing OAuth cookie", { status: 400 });

  let oauth: any;
  try {
    oauth = JSON.parse(oauthRaw);
  } catch {
    return new Response("Bad OAuth cookie", { status: 400 });
  }

  if (oauth.state !== state) return new Response("State mismatch", { status: 400 });

  // Exchange code -> tokens
  const token = await exchangeCodeForTokens(
    {
      IRACING_CLIENT_ID: context.env.IRACING_CLIENT_ID,
      IRACING_CLIENT_SECRET: context.env.IRACING_CLIENT_SECRET,
      IRACING_REDIRECT_URI: context.env.IRACING_REDIRECT_URI,
    },
    code,
    oauth.verifier
  );

  const accessExpiresAt = new Date(Date.now() + (token.expires_in ?? 600) * 1000).toISOString();

  // Identify current member via member_recent_races (authed “me”)
  // Note: /data endpoints often return { link }, which we follow in iracingDataGet()
  const recent = await iracingDataGet<MemberRecentRaces>(
    "/data/stats/member_recent_races",
    token.access_token
  );

  // Extract member identity defensively (schema varies by wrapper)
  const identity = extractIdentity(recent);
  if (!identity?.iracingId) return new Response("Could not determine iRacing identity", { status: 500 });

  const now = new Date().toISOString();

  // Upsert user by iracing_member_id
  const existing = await DB.prepare(`SELECT id FROM users WHERE iracing_member_id = ?`)
    .bind(identity.iracingId)
    .first<any>();

  const userId = existing?.id ?? crypto.randomUUID();

  if (!existing?.id) {
    await DB.prepare(
      `INSERT INTO users (id, iracing_member_id, display_name, created_at) VALUES (?, ?, ?, ?)`
    ).bind(userId, String(identity.iracingId), identity.name ?? `Driver ${identity.iracingId}`, now).run();
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
  ).bind(
    userId,
    token.access_token,
    token.refresh_token ?? null,
    accessExpiresAt,
    null,
    token.scope ?? null,
    now
  ).run();

  // Create GridRep auth session (30 days)
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, now, expiresAt, now).run();

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

  const returnTo = typeof oauth.returnTo === "string" ? oauth.returnTo : "/";
  headers.set("Location", returnTo);

  return new Response(null, { status: 302, headers });
}

function extractIdentity(recent: any): { iracingId?: string; name?: string } {
  // Try common patterns
  if (recent?.cust_id) return { iracingId: String(recent.cust_id), name: recent.display_name ?? recent.name };
  if (recent?.member?.cust_id) return { iracingId: String(recent.member.cust_id), name: recent.member.display_name };

  // Many shapes have "races" or "results" arrays
  const arr =
    recent?.races ??
    recent?.results ??
    recent?.recent_races ??
    recent?.data ??
    [];

  if (Array.isArray(arr) && arr.length) {
    const r = arr[0];
    const id = r?.cust_id ?? r?.member_id ?? r?.driver_id ?? r?.driver?.cust_id;
    const name = r?.display_name ?? r?.driver_name ?? r?.name ?? r?.driver?.display_name;
    if (id) return { iracingId: String(id), name };
  }

  return {};
}
