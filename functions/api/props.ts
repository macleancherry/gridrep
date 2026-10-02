import { jsonError } from "../_lib/httpJson";

// The props app (giving a "GG"/compliment to another driver) is retired - see
// functions/api/feed.ts for why this now returns 410 instead of writing a prop.
export async function onRequest() {
  return jsonError(410, { error: "retired", message: "Giving props has been retired." });
}
