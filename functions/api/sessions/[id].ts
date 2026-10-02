import { jsonError } from "../../_lib/httpJson";

// The props app is retired - see functions/api/feed.ts for why this now returns
// 410 instead of a full grid's real names+custids for any cached session.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "Session pages have been retired." });
}
