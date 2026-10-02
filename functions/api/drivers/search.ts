import { jsonError } from "../../_lib/httpJson";

// The props app is retired - see functions/api/feed.ts for why this now returns
// 410 instead of a name/custid search over every driver gridrep has ever cached.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "Driver search has been retired." });
}
