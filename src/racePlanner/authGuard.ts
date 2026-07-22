/**
 * Detects a dead iRacing connection (refresh token expired/revoked - e.g. iRacing rotates
 * or invalidates it server-side) across every race-planner API call, without needing every
 * one of the ~20+ fetch call sites to check for it individually.
 *
 * Every backend endpoint that calls getValidAccessToken() (functions/_lib/auth.ts) already
 * returns a consistent 401 { error: "auth_required" } when the iRacing token itself can't
 * be refreshed - distinct from { error: "not_verified" }, which means no gridrep session at
 * all and is already handled by RacePlannerLayout's sign-in gate. auth_required is the "you
 * have a valid gridrep login, but iRacing itself needs you to reconnect" case, which today
 * had no UI at all - a page would just show whatever generic error message it happened to
 * render, with no way to actually fix it.
 *
 * Wraps window.fetch once (idempotent - safe to call from multiple component mounts) and
 * peeks every response body via .clone() so the original caller's own .json() still works
 * unmodified. Fires the "auth-required" event at most once per page load; the reconnect
 * flow is a full navigation anyway, so there's nothing to reset back to "not triggered".
 */

const EVENT_NAME = "rp:auth-required";
let installed = false;
let triggered = false;

export function installAuthGuard() {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (!triggered && response.status === 401) {
      try {
        const data = await response.clone().json();
        if (data?.error === "auth_required") {
          triggered = true;
          window.dispatchEvent(new Event(EVENT_NAME));
        }
      } catch {
        // Not a JSON body - not one of our API responses, ignore.
      }
    }
    return response;
  };
}

export function onAuthRequired(callback: () => void): () => void {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}
