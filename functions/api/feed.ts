import { jsonError } from "../_lib/httpJson";

// The props app (feed/leaderboard/driver/session pages) is retired - Gridrep
// refocuses on team and pace tools (the race planner, Pace, What-If). This
// endpoint used to serve real names/custids to anyone, cached publicly with no
// login - kept as a real route (rather than a 404) so any stale bookmark or
// cached link gets a clear, unambiguous answer instead of looking broken.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "The props feed has been retired." });
}
