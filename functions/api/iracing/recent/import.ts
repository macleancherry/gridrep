import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { iracingDataGet } from "../../../_lib/iracing";
import { importSubsessionToCache } from "../session/[id]/import";

type RecentRaceRow = { subsession_id?: number; subsessionId?: number };

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return new Response("Verify required", { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const accessToken = await getValidAccessToken(context, viewer.user!.id);

  const payload = await iracingDataGet<any>(`/data/stats/member_recent_races`, accessToken);

  const rows: RecentRaceRow[] =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.races) && payload.races) ||
    (Array.isArray(payload?.recent_races) && payload.recent_races) ||
    (Array.isArray(payload?.results) && payload.results) ||
    [];

  // Keep conservative: import first 10
  const subsessionIds = rows
    .map((r) => r.subsession_id ?? (r as any).subsessionId)
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .slice(0, 10)
    .map(String);

  let sessionsImported = 0;

  for (const sid of subsessionIds) {
    try {
      await importSubsessionToCache(context, sid);
      sessionsImported += 1;
    } catch (e: any) {
      console.log("recent/import: session import failed (safe)", { sid, msg: e?.message ?? String(e) });
    }
  }

  return Response.json(
    { ok: true, sessionsImported, subsessionIds },
    { headers: { "Cache-Control": "no-store" } }
  );
}
