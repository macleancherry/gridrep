import { jsonError } from "../../../_lib/httpJson";

// This endpoint's only caller was the retired props app's "sync my recent races"
// button (src/pages/Home.tsx) - see functions/api/feed.ts for why that app is gone.
// Retired alongside it rather than left as an orphaned-but-reachable import path
// that still wrote real names into the shared drivers/session_participants cache.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "This endpoint has been retired." });
}
