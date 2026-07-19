import { buildAuthorizeUrl } from "../../../_lib/garage61";
import { serializeCookie } from "../../../_lib/cookies";
import { getViewer } from "../../../_lib/auth";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

/** Same allow-list as the iRacing /api/auth/start - relative paths only. */
function normalizeReturnTo(input: string | null): string {
  const fallback = "/race-planner";

  if (!input) return fallback;

  const s = input.trim();
  if (!s || s.length > 2048) return fallback;
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;

  const lowered = s.toLowerCase();
  if (lowered.includes("javascript:") || lowered.includes("data:")) return fallback;

  return s;
}

export async function onRequestGet(context: any) {
  const debugId = crypto.randomUUID();
  const url = new URL(context.request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get("returnTo"));

  // Garage 61 is a secondary account link on top of an existing gridrep session - a
  // signed-out visitor gets bounced through iRacing sign-in first, then straight back here.
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    const selfHref = `/api/auth/garage61/start?returnTo=${encodeURIComponent(returnTo)}`;
    const headers = new Headers();
    headers.set("Location", `/api/auth/start?returnTo=${encodeURIComponent(selfHref)}`);
    headers.set("X-GridRep-Debug-Id", debugId);
    return new Response(null, { status: 302, headers });
  }

  safeLog("log", debugId, "auth.garage61.start", { returnTo, userId: viewer.user?.id });

  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, returnTo });
  const cookie = serializeCookie("gr_g61_oauth", payload, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60,
  });

  const authUrl = buildAuthorizeUrl({
    clientId: context.env.GARAGE61_CLIENT_ID,
    redirectUri: context.env.GARAGE61_REDIRECT_URI,
    state,
    scope: "driving_data",
  });

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      Location: authUrl,
      "X-GridRep-Debug-Id": debugId,
    },
  });
}
