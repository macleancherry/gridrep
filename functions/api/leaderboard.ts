import { jsonError } from "../_lib/httpJson";

// The props app is retired - see functions/api/feed.ts for why this now returns
// 410 instead of the names+custids it used to serve to anyone, cached publicly.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "The leaderboard has been retired." });
}
