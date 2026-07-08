import { getViewer, getValidAccessToken } from "./auth";
import {
  fetchSubsessionResult,
  fetchLapData,
  buildLapDataPath,
  identifySimSessions,
  extractDriverNames,
  extractSessionHeader,
  extractLapRows,
  extractLapNumber,
  normalizeLapTimeMs,
  describeIracingError,
  describeSimSessionBlocks,
} from "./paceIracing";
import { classifyLap } from "./cleanPace";
import { runWithConcurrency, sleep } from "./concurrency";

function safeLog(level: "log" | "warn" | "error", debugId: string, msg: string, extra: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

export class PaceIngestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaceIngestError";
    this.code = code;
  }
}

type IngestOpts = {
  leagueId?: string | null;
  viewerUserId?: string;
  accessToken?: string;
  lapFetchDelayMs?: number;
  lapFetchConcurrency?: number;
  /** Cap on new (driver, sim-session) lap_data fetches per call - Cloudflare Workers caps subrequests per invocation, so a large field (many drivers) has to be pulled across several calls. */
  maxJobsPerRun?: number;
};

export type IngestSummary = {
  ok: true;
  subsessionId: string;
  simSessionsIngested: number;
  driversIngested: number;
  lapsIngested: number;
  driverFailures: Array<{ custId: string; simsessionNumber: number; message: string }>;
  /** Raw lap_data payload shape, captured once when a fetch succeeded but yielded zero laps - unverified field names (PRD §6/§10.5). */
  emptyLapPayloadSample?: string;
  /** Total (driver, sim-session) pairs for this subsession, whether done in a prior call or this one. */
  totalJobs: number;
  /** How many of totalJobs still have no stored laps and weren't attempted this run - call again to continue. */
  remainingJobs: number;
  /** True if this call was a no-op because a prior call already finished this subsession (laps_complete=1). */
  alreadyComplete?: boolean;
};

/**
 * Ingest (or re-ingest) a subsession: pulls the result to find qualifying/race
 * sim-sessions + participants, then pulls lap data per driver per sim-session.
 * Idempotent - re-running replaces this subsession's stored laps.
 */
export async function ingestPaceSubsession(context: any, subsessionId: string, opts: IngestOpts = {}): Promise<IngestSummary> {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;

  let accessToken = opts.accessToken;
  if (!accessToken) {
    const viewer = opts.viewerUserId ? null : await getViewer(context);
    const userId = opts.viewerUserId ?? viewer?.user?.id;

    if (!userId || (viewer && !viewer.verified)) {
      throw new PaceIngestError("not_verified", "Verification required to sync a subsession.");
    }

    try {
      accessToken = await getValidAccessToken(context, userId);
    } catch {
      throw new PaceIngestError("auth_required", "Please verify again to continue.");
    }
  }

  // Skip entirely (no iRacing calls at all) if a prior call already finished
  // this subsession - matters most for league sync, which can rediscover the
  // same backlog of subsessions across many resumed calls before its own
  // search window advances, and shouldn't burn subrequests re-checking ones
  // that are already done.
  const existing = await DB.prepare(`SELECT laps_complete FROM pace_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<{ laps_complete: number }>();

  if (existing?.laps_complete) {
    const stats = await DB.prepare(
      `SELECT COUNT(*) as lapsIngested, COUNT(DISTINCT cust_id) as driversIngested,
              COUNT(DISTINCT simsession_number) as simSessionsIngested,
              COUNT(DISTINCT cust_id || ':' || simsession_number) as totalJobs
       FROM pace_laps WHERE subsession_id = ?`
    )
      .bind(subsessionId)
      .first<{ lapsIngested: number; driversIngested: number; simSessionsIngested: number; totalJobs: number }>();

    return {
      ok: true,
      subsessionId,
      simSessionsIngested: stats?.simSessionsIngested ?? 0,
      driversIngested: stats?.driversIngested ?? 0,
      lapsIngested: stats?.lapsIngested ?? 0,
      driverFailures: [],
      totalJobs: stats?.totalJobs ?? 0,
      remainingJobs: 0,
      alreadyComplete: true,
    };
  }

  safeLog("log", debugId, "pace.ingest.start", { subsessionId });

  let resultPayload: any;
  try {
    resultPayload = await fetchSubsessionResult(subsessionId, accessToken);
  } catch (err: any) {
    safeLog("error", debugId, "pace.ingest.result_fetch_failed", {
      subsessionId,
      message: err?.message ?? String(err),
    });
    throw new PaceIngestError("iracing_fetch_failed", `Failed to fetch subsession result from iRacing: ${describeIracingError(err)}`);
  }

  const header = extractSessionHeader(resultPayload);
  const simSessions = identifySimSessions(resultPayload);
  const driverNames = extractDriverNames(resultPayload);

  if (simSessions.length === 0) {
    throw new PaceIngestError(
      "no_sim_sessions",
      `No qualifying or race sim-sessions found for this subsession. Blocks seen: ${describeSimSessionBlocks(resultPayload)}`
    );
  }

  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO pace_subsessions (subsession_id, league_id, track_name, series_name, start_time, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(subsession_id) DO UPDATE SET
       league_id = COALESCE(excluded.league_id, pace_subsessions.league_id),
       track_name = COALESCE(excluded.track_name, pace_subsessions.track_name),
       series_name = COALESCE(excluded.series_name, pace_subsessions.series_name),
       start_time = COALESCE(excluded.start_time, pace_subsessions.start_time),
       ingested_at = excluded.ingested_at`
  )
    .bind(subsessionId, opts.leagueId ?? null, header.track_name ?? null, header.series_name ?? null, header.start_time ?? null, now)
    .run();

  for (const [custId, name] of driverNames) {
    await DB.prepare(
      `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(iracing_member_id) DO UPDATE SET
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`
    )
      .bind(custId, name, now)
      .run();
  }

  const concurrency = Math.max(1, Math.min(5, opts.lapFetchConcurrency ?? 2));
  const delayMs = Math.max(0, Math.min(5000, opts.lapFetchDelayMs ?? 400));
  const maxJobsPerRun = Math.max(1, Math.min(50, opts.maxJobsPerRun ?? 12));

  const driverFailures: IngestSummary["driverFailures"] = [];
  let lapsIngested = 0;

  const allJobs: Array<{ custId: string; simsessionNumber: number; type: "qualifying" | "race" }> = [];
  for (const sess of simSessions) {
    for (const custId of sess.custIds) {
      allJobs.push({ custId, simsessionNumber: sess.simsessionNumber, type: sess.type });
    }
  }

  if (allJobs.length === 0) {
    throw new PaceIngestError(
      "no_participants",
      `Found ${simSessions.length} sim-session(s) but no participant cust_ids in them. Blocks seen: ${describeSimSessionBlocks(resultPayload)}`
    );
  }

  // Already-stored (cust_id, simsession_number) pairs don't need refetching -
  // this both keeps re-runs idempotent/cheap and makes ingestion resumable
  // across multiple calls, since Cloudflare Workers caps subrequests per
  // invocation and a large field can need far more lap_data calls than that.
  const doneRows = await DB.prepare(
    `SELECT DISTINCT cust_id as custId, simsession_number as simsessionNumber FROM pace_laps WHERE subsession_id = ?`
  )
    .bind(subsessionId)
    .all<{ custId: string; simsessionNumber: number }>();
  const doneKeys = new Set((doneRows.results ?? []).map((r) => `${r.custId}:${r.simsessionNumber}`));

  const pendingJobs = allJobs.filter((j) => !doneKeys.has(`${j.custId}:${j.simsessionNumber}`));
  const jobs = pendingJobs.slice(0, maxJobsPerRun);
  const unattemptedJobs = pendingJobs.length - jobs.length;

  let processed = 0;
  const outcomes = await runWithConcurrency(jobs, concurrency, async (job) => {
    if (processed > 0 && delayMs > 0) await sleep(delayMs);
    processed += 1;

    const payload = await fetchLapData(subsessionId, job.custId, job.simsessionNumber, accessToken!);
    const rows = await extractLapRows(payload);
    const sample =
      rows.length === 0
        ? `GET ${buildLapDataPath(subsessionId, job.custId, job.simsessionNumber)} -> ${JSON.stringify(payload).slice(0, 700)}`
        : undefined;
    const statements: any[] = [];

    for (const row of rows) {
      const lapNumber = extractLapNumber(row);
      if (lapNumber === undefined) continue;

      const lapTimeMs = normalizeLapTimeMs(row);
      const { isPitLap, isClean, flagsRaw, flagsDecoded } = classifyLap(row);

      statements.push(
        DB.prepare(
          `INSERT INTO pace_laps (
             subsession_id, cust_id, simsession_number, simsession_type, lap_number,
             lap_time_ms, flags_raw, flags_decoded, is_pit_lap, is_clean, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(subsession_id, cust_id, simsession_number, lap_number) DO UPDATE SET
             lap_time_ms = excluded.lap_time_ms,
             flags_raw = excluded.flags_raw,
             flags_decoded = excluded.flags_decoded,
             is_pit_lap = excluded.is_pit_lap,
             is_clean = excluded.is_clean`
        ).bind(
          subsessionId,
          job.custId,
          job.simsessionNumber,
          job.type,
          lapNumber,
          lapTimeMs,
          flagsRaw,
          JSON.stringify(flagsDecoded),
          isPitLap ? 1 : 0,
          isClean === null ? null : isClean ? 1 : 0,
          now
        )
      );
    }

    if (statements.length > 0) await DB.batch(statements);
    return { count: statements.length, sample };
  });

  const simSessionsSeen = new Set<number>();
  let emptyLapPayloadSample: string | undefined;
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const job = jobs[i];
    if (outcome.ok) {
      const { count, sample } = outcome.value as { count: number; sample?: string };
      lapsIngested += count;
      simSessionsSeen.add(job.simsessionNumber);
      if (count === 0 && sample && !emptyLapPayloadSample) emptyLapPayloadSample = sample;
    } else {
      const err: any = outcome.error;
      const message = describeIracingError(err);
      safeLog("warn", debugId, "pace.ingest.driver_lap_fetch_failed", {
        subsessionId,
        custId: job.custId,
        simsessionNumber: job.simsessionNumber,
        message,
      });
      driverFailures.push({
        custId: job.custId,
        simsessionNumber: job.simsessionNumber,
        message,
      });
    }
  }

  // A failed job still needs a retry, same as one that was never attempted.
  const remainingJobs = unattemptedJobs + driverFailures.length;
  const fullyDone = remainingJobs === 0;
  if (fullyDone) {
    await DB.prepare(`UPDATE pace_subsessions SET laps_complete = 1 WHERE subsession_id = ?`).bind(subsessionId).run();
  }

  safeLog("log", debugId, "pace.ingest.ok", {
    subsessionId,
    lapsIngested,
    driverFailures: driverFailures.length,
    remainingJobs,
    fullyDone,
  });

  return {
    ok: true,
    subsessionId,
    simSessionsIngested: simSessionsSeen.size,
    driversIngested: driverNames.size,
    lapsIngested,
    driverFailures,
    emptyLapPayloadSample,
    totalJobs: allJobs.length,
    remainingJobs,
  };
}
