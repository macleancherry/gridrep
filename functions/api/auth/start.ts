import { createPkcePair, buildAuthorizeUrl } from "../../_lib/iracing";
import { serializeCookie } from "../../_lib/cookies";

export async function onRequestGet(context: any) {
  const url = new URL(context.request.url);
  const returnTo = url.searchParams.get("returnTo") || "/";

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
    },
  });
}
