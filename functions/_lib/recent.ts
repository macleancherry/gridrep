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

type TokenOwner = {
  id: string;
  iracingMemberId: string | null;
};

function extractRaceRows(payload: any): RecentRaceRow[] {
  return (
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.races) && payload.races) ||
    (Array.isArray(payload?.recent_races) && payload.recent_races) ||
    (Array.isArray(payload?.results) && payload.results) ||
    []
  );
}

function rowMatchesRequestedMember(row: any, requestedMemberId: string): boolean {
  const candidate =
    row?.cust_id ??
    row?.customer_id ??
    row?.customerId ??
    row?.iracing_member_id ??
    row?.member_id ??
    row?.memberId;

  if (candidate == null) return true;
  return String(candidate) === requestedMemberId;
}

async function listTokenOwners(DB: D1Database, requestedMemberId: string): Promise<TokenOwner[]> {
  const rows = await DB.prepare(
    `SELECT u.id as id, u.iracing_member_id as iracingMemberId
     FROM users u
     JOIN oauth_tokens t ON t.user_id = u.id
     ORDER BY CASE WHEN u.iracing_member_id = ? THEN 0 ELSE 1 END,
              datetime(t.updated_at) DESC,
              u.id ASC`
  )
    .bind(requestedMemberId)
    .all<TokenOwner>();

  return rows.results ?? [];
}

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

  const tokenOwners = await listTokenOwners(DB, memberId);
  if (tokenOwners.length === 0) {
    return { ok: false, imported: 0, failed: 0, skipped: 0, reason: "no_verified_token" };
  }

  let viewerUserId: string | null = null;
  let accessToken: string | null = null;
  let rows: RecentRaceRow[] = [];

  const queryPaths = [
    `/data/stats/member_recent_races?cust_id=${encodeURIComponent(memberId)}`,
    `/data/stats/member_recent_races?customer_id=${encodeURIComponent(memberId)}`,
    "/data/stats/member_recent_races",
  ];

  for (const owner of tokenOwners) {
    let token: string;
    try {
      token = await getValidAccessToken(context, owner.id);
    } catch {
      continue;
    }

    for (const path of queryPaths) {
      try {
        const payload = await iracingDataGet<any>(path, token);
        const candidateRows = extractRaceRows(payload).filter((row) => rowMatchesRequestedMember(row, memberId));

        if (candidateRows.length > 0) {
          viewerUserId = owner.id;
          accessToken = token;
          rows = candidateRows;
          break;
        }
      } catch {
        // Try the next path/token owner.
      }
    }

    if (rows.length > 0) break;
  }

  if (!viewerUserId || !accessToken) {
    return { ok: false, imported: 0, failed: 0, skipped: 0, reason: "recent_races_fetch_failed" };
  }

  const subsessionIds = rows
    .map((row) => row.subsession_id ?? row.subsessionId)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .slice(0, Math.max(1, Math.min(250, limit)))
    .map(String);

  if (subsessionIds.length === 0) {
    return { ok: true, imported: 0, failed: 0, skipped: 0, reason: "no_recent_races" };
  }

  const outcomes = await runWithConcurrency(subsessionIds, 3, async (subsessionId) => {
    return importSubsessionToCache(context, subsessionId, {
      viewerUserId,
      accessToken,
      forceRefresh: true,
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