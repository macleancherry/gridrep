import { createPkcePair, buildAuthorizeUrl } from "../../_lib/iracing";
import { serializeCookie } from "../../_lib/cookies";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

/**
 * Only allow relative returnTo paths (prevents open redirects).
 * Examples allowed: "/", "/drivers/123", "/sessions/999?tab=grid"
 * Examples rejected: "https://evil.com", "//evil.com", "javascript:..."
 */
function normalizeReturnTo(input: string | null): string {
  const fallback = "/";

  if (!input) return fallback;

  // Trim and enforce a reasonable length
  const s = input.trim();
  if (!s) return fallback;
  if (s.length > 2048) return fallback;

  // Must be a relative path starting with exactly one "/"
  // Disallow protocol-relative "//"
  if (!s.startsWith("/")) return fallback;
  if (s.startsWith("//")) return fallback;

  // Disallow obvious scheme injections even if someone tries "/\nhttps://..."
  const lowered = s.toLowerCase();
  if (lowered.includes("javascript:") || lowered.includes("data:")) return fallback;

  return s;
}

export async function onRequestGet(context: any) {
  const debugId = crypto.randomUUID();
  const url = new URL(context.request.url);

  const rawReturnTo = url.searchParams.get("returnTo");
  const returnTo = normalizeReturnTo(rawReturnTo);

  safeLog("log", debugId, "auth.start", {
    rawReturnTo: rawReturnTo ?? null,
    returnTo,
  });

  const state = crypto.randomUUID();
  const { verifier, challenge } = await createPkcePair();

  // Short-lived cookie (10 minutes)
  const payload = JSON.stringify({ state, verifier, returnTo });
  const cookie = serializeCookie("gr_oauth", payload, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60,
  });

  const authUrl = buildAuthorizeUrl({
    clientId: context.env.IRACING_CLIENT_ID,
    redirectUri: context.env.IRACING_REDIRECT_URI,
    state,
    codeChallenge: challenge,
    scope: "iracing.auth",
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
