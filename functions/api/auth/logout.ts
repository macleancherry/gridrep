import { parseCookies, clearCookie } from "../../_lib/cookies";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

function isPurgeAllowed(context: any): boolean {
  const enabled = String(context.env?.AUTH_PURGE_ENABLED ?? "") === "1";
  const secret = String(context.env?.AUTH_PURGE_SECRET ?? "");

  if (!enabled) return false;
  if (!secret) return false;

  const header = context.request.headers.get("X-GridRep-Admin") ?? "";
  return header === secret;
}

export async function onRequestPost(context: any) {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;

  const url = new URL(context.request.url);
  const purgeRequested = url.searchParams.get("purge") === "1";

  const cookies = parseCookies(context.request);
  const sid = cookies["gr_session"];

  safeLog("log", debugId, "auth.logout.start", {
    hasSessionCookie: Boolean(sid),
    purgeRequested,
  });

  // Resolve userId BEFORE deleting session so purge can be reliable
  let userId: string | null = null;
  if (sid) {
    try {
      const sess = await DB.prepare(`SELECT user_id as userId FROM auth_sessions WHERE id = ?`)
        .bind(sid)
        .first<any>();
      userId = sess?.userId ? String(sess.userId) : null;
    } catch (err: any) {
      safeLog("warn", debugId, "auth.logout.lookup_user_failed", {
        message: err?.message ?? String(err),
      });
      userId = null;
    }
  }

  // Always delete the auth session row if present
  if (sid) {
    try {
      await DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(sid).run();
    } catch (err: any) {
      safeLog("warn", debugId, "auth.logout.delete_session_failed", {
        message: err?.message ?? String(err),
      });
      // continue: logout should still clear cookies
    }
  }

  // Optional: dev-gated purge of oauth_tokens for the user
  if (purgeRequested) {
    if (!isPurgeAllowed(context)) {
      safeLog("warn", debugId, "auth.logout.purge_denied");
      return new Response(
        JSON.stringify({
          error: "forbidden",
          message: "Purge is not enabled for this environment.",
          debugId,
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "X-GridRep-Debug-Id": debugId,
            // clear cookies anyway
            "Set-Cookie": [clearCookie("gr_session"), clearCookie("gr_oauth")].join(", "),
          },
        }
      );
    }

    if (userId) {
      try {
        await DB.prepare(`DELETE FROM oauth_tokens WHERE user_id = ?`).bind(userId).run();
        safeLog("log", debugId, "auth.logout.purge_ok", { userId });
      } catch (err: any) {
        safeLog("warn", debugId, "auth.logout.purge_failed", { message: err?.message ?? String(err) });
        // continue: still clear cookies
      }
    } else {
      safeLog("warn", debugId, "auth.logout.purge_skipped_no_user");
    }
  }

  // Clear cookies (also clear gr_oauth to avoid stuck mid-flow states)
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": [clearCookie("gr_session"), clearCookie("gr_oauth")].join(", "),
      "Cache-Control": "no-store",
      "X-GridRep-Debug-Id": debugId,
    },
  });
}
