import { jsonError } from "../../_lib/httpJson";

// The props app is retired - see functions/api/feed.ts for why this now returns
// 410 instead of a driver's real name+custid+props/session history to anyone.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "Driver pages have been retired." });
}
