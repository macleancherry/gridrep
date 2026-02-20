import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { iracingDataGet } from "../../../_lib/iracing";
import { importSubsessionToCache } from "../session/[subsessionId]/import";

type RecentRaceRow = { subsession_id?: number; subsessionId?: number };

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<{ results: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: any }> }> {
  const queue = [...items];
  const out: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: any }> = [];

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        const value = await worker(item);
        out.push({ item, ok: true, value });
      } catch (error) {
        out.push({ item, ok: false, error });
      }
    }
  });

  await Promise.all(runners);
  return { results: out };
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return new Response("Verify required", { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // One token for the whole import
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

  const CONCURRENCY = 3;

  const { results } = await runWithConcurrency(subsessionIds, CONCURRENCY, async (sid) => {
    return await importSubsessionToCache(context, sid, {
      viewerUserId: viewer.user!.id,
      accessToken,
    });
  });

  const sessionsImported = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  // Keep logging safe + minimal
  for (const r of results) {
    if (!r.ok) {
      console.log("recent/import: session import failed (safe)", {
        sid: r.item,
        msg: r.error?.message ?? String(r.error),
        code: r.error?.code ?? undefined,
      });
    }
  }

  return Response.json(
    { ok: true, sessionsImported, failed, subsessionIds, concurrency: CONCURRENCY },
    { headers: { "Cache-Control": "no-store" } }
  );
}