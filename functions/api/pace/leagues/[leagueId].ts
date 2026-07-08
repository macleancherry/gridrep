import { getViewer } from "../../../_lib/auth";
import { json, jsonError } from "../../../_lib/httpJson";

export async function onRequestDelete(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to unfollow a league." });
  }

  const leagueId = context.params.leagueId as string;
  const { DB } = context.env;

  await DB.prepare(`DELETE FROM pace_leagues WHERE league_id = ?`).bind(leagueId).run();

  return json({ ok: true, leagueId });
}
