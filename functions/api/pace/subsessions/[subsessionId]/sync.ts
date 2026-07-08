import { ingestPaceSubsession, PaceIngestError } from "../../../../_lib/paceIngest";
import { json, jsonError } from "../../../../_lib/httpJson";

export async function onRequestPost(context: any) {
  const subsessionId = context.params.subsessionId as string;

  try {
    const summary = await ingestPaceSubsession(context, subsessionId);
    return json(summary);
  } catch (err: any) {
    if (err instanceof PaceIngestError) {
      const statusByCode: Record<string, number> = {
        not_verified: 401,
        auth_required: 401,
        no_sim_sessions: 404,
        no_participants: 404,
        iracing_fetch_failed: 502,
      };
      const status = statusByCode[err.code] ?? 400;
      return jsonError(status, { error: err.code, message: err.message });
    }

    console.error(JSON.stringify({ level: "error", msg: "pace.subsession.sync.unhandled", message: err?.message ?? String(err) }));
    return jsonError(500, { error: "sync_failed", message: "Sync failed. Please try again." });
  }
}
