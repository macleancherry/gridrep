import { getValidAccessToken } from "./auth";
import { iracingDataGet } from "./iracing";
import { importSubsessionToCache } from "../api/iracing/session/[subsessionId]/import";

type RecentRaceRow = Record<string, unknown>;

export type RefreshOptions = {
  mode?: "recent" | "window";
  windowStart?: string;
  windowEnd?: string;
  importConcurrency?: number;
  importDelayMs?: number;
  queryDelayMs?: number;
  chunkDelayMs?: number;
  maxChunkFiles?: number;
  includeHosted?: boolean;
  officialOnly?: boolean;
};

type RefreshResult = {
  ok: boolean;
  imported: number;
  failed: number;
  skipped: number;
  discovered: number;
  mode: "recent" | "window";
  windowStart?: string;
  windowEnd?: string;
  reason?: string;
};

type TokenOwner = {
  id: string;
  iracingMemberId: string | null;
};

function extractRaceRows(payload: unknown): RecentRaceRow[] {
  const data = payload as any;
  return (
    (Array.isArray(data) && data) ||
    (Array.isArray(data?.races) && data.races) ||
    (Array.isArray(data?.recent_races) && data.recent_races) ||
    (Array.isArray(data?.results) && data.results) ||
    []
  );
}

function extractSubsessionId(row: Record<string, unknown>): string | null {
  const value =
    row.subsession_id ??
    row.subsessionId ??
    row.subsessionid ??
    row.sub_session_id ??
    row.subSessionId ??
    row.session_id;

  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function collectSubsessionIds(payload: unknown, requestedMemberId: string, maxIds: number): string[] {
  const ids = new Set<string>();
  const stack: unknown[] = [payload];

  while (stack.length > 0 && ids.size < maxIds) {
    const value = stack.pop();
    if (!value) continue;

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    if (typeof value !== "object") continue;

    const row = value as Record<string, unknown>;
    const rowMember =
      row.cust_id ??
      row.customer_id ??
      row.customerId ??
      row.iracing_member_id ??
      row.member_id ??
      row.memberId;

    const subId = extractSubsessionId(row);
    if (subId && (rowMember == null || String(rowMember) === requestedMemberId)) {
      ids.add(subId);
      if (ids.size >= maxIds) break;
    }

    for (const nested of Object.values(row)) {
      if (nested && (Array.isArray(nested) || typeof nested === "object")) {
        stack.push(nested);
      }
    }
  }

  return Array.from(ids);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function encodePath(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`https://members-ng.iracing.com${path}`);
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue;
    url.searchParams.set(key, String(raw));
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function getChunkInfo(payload: any): { baseDownloadUrl: string; chunkFileNames: string[] } | null {
  const candidates = [payload?.data?.chunk_info, payload?.chunk_info, payload?.chunkInfo].filter(Boolean);

  for (const candidate of candidates) {
    const baseDownloadUrl =
      (typeof candidate?.base_download_url === "string" && candidate.base_download_url) ||
      (typeof candidate?.baseDownloadUrl === "string" && candidate.baseDownloadUrl) ||
      null;

    const chunkFileNamesRaw = candidate?.chunk_file_names ?? candidate?.chunkFileNames;
    const chunkFileNames = Array.isArray(chunkFileNamesRaw)
      ? chunkFileNamesRaw.filter((item: unknown): item is string => typeof item === "string" && item.length > 0)
      : [];

    if (baseDownloadUrl && chunkFileNames.length > 0) {
      return { baseDownloadUrl, chunkFileNames };
    }
  }

  return null;
}

async function fetchChunkRows(
  payload: unknown,
  opts: { chunkDelayMs: number; maxChunkFiles: number }
): Promise<RecentRaceRow[]> {
  const chunkInfo = getChunkInfo(payload as any);
  if (!chunkInfo) return [];

  const rows: RecentRaceRow[] = [];
  const fileNames = chunkInfo.chunkFileNames.slice(0, opts.maxChunkFiles);

  for (const fileName of fileNames) {
    const chunkUrl = `${chunkInfo.baseDownloadUrl}${fileName}`;
    const res = await fetch(chunkUrl);
    if (!res.ok) continue;

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (Array.isArray(parsed)) {
      rows.push(...(parsed as RecentRaceRow[]));
    } else if (parsed && typeof parsed === "object") {
      rows.push(...extractRaceRows(parsed));
    }

    if (opts.chunkDelayMs > 0) {
      await sleep(opts.chunkDelayMs);
    }
  }

  return rows;
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
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }>> {
  const queue = [...items];
  const output: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }> = [];
  let index = 0;

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const currentIndex = index;
      index += 1;

      try {
        const value = await worker(item, currentIndex);
        output.push({ item, ok: true, value });
      } catch (error) {
        output.push({ item, ok: false, error });
      }
    }
  });

  await Promise.all(runners);
  return output;
}

export async function refreshRecentRacesForMember(
  context: any,
  memberId: string,
  limit = 20,
  options?: RefreshOptions
): Promise<RefreshResult> {
  const { DB } = context.env;
  const mode = options?.mode === "window" ? "window" : "recent";
  const boundedLimit = clampInt(limit, 1, 500, 20);
  const importConcurrency = clampInt(options?.importConcurrency, 1, 5, 1);
  const importDelayMs = clampInt(options?.importDelayMs, 0, 5000, 750);
  const queryDelayMs = clampInt(options?.queryDelayMs, 0, 5000, 350);
  const chunkDelayMs = clampInt(options?.chunkDelayMs, 0, 5000, 350);
  const maxChunkFiles = clampInt(options?.maxChunkFiles, 1, 200, 50);
  const includeHosted = options?.includeHosted !== false;
  const officialOnly = options?.officialOnly !== false;

  const tokenOwners = await listTokenOwners(DB, memberId);
  if (tokenOwners.length === 0) {
    return {
      ok: false,
      imported: 0,
      failed: 0,
      skipped: 0,
      discovered: 0,
      mode,
      windowStart: options?.windowStart,
      windowEnd: options?.windowEnd,
      reason: "no_verified_token",
    };
  }

  let viewerUserId: string | null = null;
  let accessToken: string | null = null;
  const discoveredSubsessionIds = new Set<string>();

  const nowIso = new Date().toISOString();
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const queryPaths =
    mode === "window"
      ? [
          encodePath("/data/results/search_series", {
            cust_id: memberId,
            finish_range_begin: options?.windowStart,
            finish_range_end: options?.windowEnd,
            official_only: officialOnly,
          }),
          ...(includeHosted
            ? [
                encodePath("/data/results/search_hosted", {
                  cust_id: memberId,
                  finish_range_begin: options?.windowStart,
                  finish_range_end: options?.windowEnd,
                }),
              ]
            : []),
        ]
      : [
          `/data/stats/member_recent_races?cust_id=${encodeURIComponent(memberId)}`,
          `/data/stats/member_recent_races?customer_id=${encodeURIComponent(memberId)}`,
          "/data/stats/member_recent_races",
          encodePath("/data/results/search_series", {
            cust_id: memberId,
            finish_range_begin: ninetyDaysAgoIso,
            finish_range_end: nowIso,
            official_only: officialOnly,
          }),
          ...(includeHosted
            ? [
                encodePath("/data/results/search_hosted", {
                  cust_id: memberId,
                  finish_range_begin: ninetyDaysAgoIso,
                  finish_range_end: nowIso,
                }),
              ]
            : []),
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
        const maxCandidates = Math.max(25, Math.min(500, boundedLimit * 3));
        const candidateIds = collectSubsessionIds(payload, memberId, maxCandidates);

        if (candidateIds.length === 0) {
          const fallbackRows = extractRaceRows(payload).filter((row) => rowMatchesRequestedMember(row, memberId));
          for (const row of fallbackRows) {
            const fallbackId = extractSubsessionId(row);
            if (fallbackId) discoveredSubsessionIds.add(fallbackId);
          }
        } else {
          for (const id of candidateIds) discoveredSubsessionIds.add(id);
        }

        if (candidateIds.length < maxCandidates) {
          const chunkRows = await fetchChunkRows(payload, { chunkDelayMs, maxChunkFiles });
          if (chunkRows.length > 0) {
            const chunkIds = collectSubsessionIds(chunkRows, memberId, maxCandidates);
            for (const id of chunkIds) discoveredSubsessionIds.add(id);
          }
        }

        if (discoveredSubsessionIds.size > 0) {
          viewerUserId = owner.id;
          accessToken = token;

          if (discoveredSubsessionIds.size >= Math.max(1, Math.min(250, boundedLimit))) {
            break;
          }
        }
      } catch {
        // Try the next path/token owner.
      }

      if (queryDelayMs > 0) {
        await sleep(queryDelayMs);
      }
    }

    if (discoveredSubsessionIds.size >= Math.max(1, Math.min(250, boundedLimit))) break;
  }

  if (!viewerUserId || !accessToken) {
    return {
      ok: false,
      imported: 0,
      failed: 0,
      skipped: 0,
      discovered: 0,
      mode,
      windowStart: options?.windowStart,
      windowEnd: options?.windowEnd,
      reason: "recent_races_fetch_failed",
    };
  }

  const subsessionIds = Array.from(discoveredSubsessionIds).slice(0, Math.max(1, Math.min(250, boundedLimit)));

  if (subsessionIds.length === 0) {
    return {
      ok: true,
      imported: 0,
      failed: 0,
      skipped: 0,
      discovered: 0,
      mode,
      windowStart: options?.windowStart,
      windowEnd: options?.windowEnd,
      reason: "no_recent_races",
    };
  }

  const outcomes = await runWithConcurrency(subsessionIds, importConcurrency, async (subsessionId, index) => {
    if (index > 0 && importDelayMs > 0) {
      await sleep(importDelayMs);
    }

    return importSubsessionToCache(context, subsessionId, {
      viewerUserId,
      accessToken,
      forceRefresh: true,
      targetMemberId: memberId,
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

  return {
    ok: true,
    imported,
    failed,
    skipped,
    discovered: discoveredSubsessionIds.size,
    mode,
    windowStart: options?.windowStart,
    windowEnd: options?.windowEnd,
  };
}
