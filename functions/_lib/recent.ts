import { getValidAccessToken } from "./auth";
import { iracingDataGet } from "./iracing";
import { importSubsessionToCache } from "../api/iracing/session/[subsessionId]/import";

type RecentRaceRow = { subsession_id?: number; subsessionId?: number };

type RefreshResult = {
  ok: boolean;
  imported: number;
  failed: number;
  skipped: number;
  reason?: string;
};

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }>> {
  const queue = [...items];
  const output: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }> = [];

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        const value = await worker(item);
        output.push({ item, ok: true, value });
      } catch (error) {
        output.push({ item, ok: false, error });
      }
    }
  });

  await Promise.all(runners);
  return output;
}

export async function refreshRecentRacesForMember(context: any, memberId: string, limit = 10): Promise<RefreshResult> {
  const { DB } = context.env;

  const user = await DB.prepare(
    `SELECT u.id as id
     FROM users u
     JOIN oauth_tokens t ON t.user_id = u.id
     WHERE u.iracing_member_id = ?
     LIMIT 1`
  )
    .bind(memberId)
    .first<{ id: string }>();

  if (!user?.id) {
    return { ok: false, imported: 0, failed: 0, skipped: 0, reason: "no_verified_token" };
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, user.id);
  } catch {
    return { ok: false, imported: 0, failed: 0, skipped: 0, reason: "token_unavailable" };
  }

  let payload: any;
  try {
    payload = await iracingDataGet<any>("/data/stats/member_recent_races", accessToken);
  } catch {
    return { ok: false, imported: 0, failed: 0, skipped: 0, reason: "recent_races_fetch_failed" };
  }

  const rows: RecentRaceRow[] =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.races) && payload.races) ||
    (Array.isArray(payload?.recent_races) && payload.recent_races) ||
    (Array.isArray(payload?.results) && payload.results) ||
    [];

  const subsessionIds = rows
    .map((row) => row.subsession_id ?? row.subsessionId)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .slice(0, Math.max(1, Math.min(25, limit)))
    .map(String);

  if (subsessionIds.length === 0) {
    return { ok: true, imported: 0, failed: 0, skipped: 0, reason: "no_recent_races" };
  }

  const outcomes = await runWithConcurrency(subsessionIds, 3, async (subsessionId) => {
    return importSubsessionToCache(context, subsessionId, {
      viewerUserId: user.id,
      accessToken,
    });
  });

  let imported = 0;
  let failed = 0;
  let skipped = 0;

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failed += 1;
      continue;
    }

    if ((outcome.value as { skipped?: boolean }).skipped) {
      skipped += 1;
    } else {
      imported += 1;
    }
  }

  return { ok: true, imported, failed, skipped };
}