import { getViewer, getValidAccessToken } from "./auth";
import {
  fetchSubsessionResult,
  fetchLapData,
  buildLapDataPath,
  identifySimSessions,
  extractDriverNames,
  extractSessionHeader,
  extractSessionConditions,
  extractLapRows,
  extractLapNumber,
  normalizeLapTimeMs,
  describeIracingError,
  describeSimSessionBlocks,
} from "./plannerIracing";
import { classifyLap } from "./plannerCleanPace";
import { runWithConcurrency, sleep } from "./concurrency";

/**
 * Subsession ingestion for the race planner - ported from functions/_lib/paceIngest.ts
 * as an independent copy writing to planner_iracing_* tables, per the PRD's "copy, don't
 * depend on Pace" decision. Same resumable/batched shape (Cloudflare Workers caps
 * subrequests per invocation), plus captures per-session weather/track-state fields on
 * the subsession row that Pace doesn't (best-effort - see plannerIracing.ts's
 * extractSessionConditions for the live-confirmation caveat).
 */

function safeLog(level: "log" | "warn" | "error", debugId: string, msg: string, extra: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

export class PlannerIngestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlannerIngestError";
    this.code = code;
  }
}

type IngestOpts = {
  leagueId?: string | null;
  eventId?: string | null;
  viewerUserId?: string;
  accessToken?: string;
  lapFetchDelayMs?: number;
  lapFetchConcurrency?: number;
  maxJobsPerRun?: number;
  /** Process this driver's own job(s) first, ahead of every other participant's. Without
   *  this, a large team session (hundreds of participants) processes jobs in payload
   *  order regardless of which specific driver a caller actually cares about - a single
   *  maxJobsPerRun-sized batch could exhaust itself on other drivers and never reach the
   *  one job the caller was waiting on. A driver has at most a couple of sim-session jobs
   *  (qualifying + race), so prioritizing them still leaves the rest of the batch free for
   *  other participants. */
  priorityCustId?: string;
};

export type IngestSummary = {
  ok: true;
  subsessionId: string;
  trackName?: string;
  simSessionsIngested: number;
  driversIngested: number;
  lapsIngested: number;
  driverFailures: Array<{ custId: string; simsessionNumber: number; message: string }>;
  emptyLapPayloadSample?: string;
  totalJobs: number;
  remainingJobs: number;
  alreadyComplete?: boolean;
};

export async function ingestPlannerSubsession(context: any, subsessionId: string, opts: IngestOpts = {}): Promise<IngestSummary> {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;

  let accessToken = opts.accessToken;
  if (!accessToken) {
    const viewer = opts.viewerUserId ? null : await getViewer(context);
    const userId = opts.viewerUserId ?? viewer?.user?.id;

    if (!userId || (viewer && !viewer.verified)) {
      throw new PlannerIngestError("not_verified", "Verification required to sync a subsession.");
    }

    try {
      accessToken = await getValidAccessToken(context, userId);
    } catch {
      throw new PlannerIngestError("auth_required", "Please verify again to continue.");
    }
  }

  const existing = await DB.prepare(`SELECT laps_complete, track_name as trackName FROM planner_iracing_subsessions WHERE subsession_id = ?`)
    .bind(subsessionId)
    .first<{ laps_complete: number; trackName: string | null }>();

  if (existing?.laps_complete) {
    const stats = await DB.prepare(
      `SELECT COUNT(*) as lapsIngested, COUNT(DISTINCT cust_id) as driversIngested,
              COUNT(DISTINCT simsession_number) as simSessionsIngested,
              COUNT(DISTINCT cust_id || ':' || simsession_number) as totalJobs
       FROM planner_iracing_laps WHERE subsession_id = ?`
    )
      .bind(subsessionId)
      .first<{ lapsIngested: number; driversIngested: number; simSessionsIngested: number; totalJobs: number }>();

    return {
      ok: true,
      subsessionId,
      trackName: existing.trackName ?? undefined,
      simSessionsIngested: stats?.simSessionsIngested ?? 0,
      driversIngested: stats?.driversIngested ?? 0,
      lapsIngested: stats?.lapsIngested ?? 0,
      driverFailures: [],
      totalJobs: stats?.totalJobs ?? 0,
      remainingJobs: 0,
      alreadyComplete: true,
    };
  }

  safeLog("log", debugId, "planner.ingest.start", { subsessionId });

  let resultPayload: any;
  try {
    resultPayload = await fetchSubsessionResult(subsessionId, accessToken);
  } catch (err: any) {
    safeLog("error", debugId, "planner.ingest.result_fetch_failed", {
      subsessionId,
      message: err?.message ?? String(err),
    });
    throw new PlannerIngestError("iracing_fetch_failed", `Failed to fetch subsession result from iRacing: ${describeIracingError(err)}`);
  }

  const header = extractSessionHeader(resultPayload);
  const conditions = extractSessionConditions(resultPayload);
  const simSessions = identifySimSessions(resultPayload);
  const driverNames = extractDriverNames(resultPayload);

  if (simSessions.length === 0) {
    throw new PlannerIngestError(
      "no_sim_sessions",
      `No qualifying or race sim-sessions found for this subsession. Blocks seen: ${describeSimSessionBlocks(resultPayload)}`
    );
  }

  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO planner_iracing_subsessions (
       subsession_id, league_id, event_id, track_name, series_name, start_time, ingested_at,
       track_temp, air_temp, track_state, time_of_day
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subsession_id) DO UPDATE SET
       league_id = COALESCE(excluded.league_id, planner_iracing_subsessions.league_id),
       event_id = COALESCE(excluded.event_id, planner_iracing_subsessions.event_id),
       track_name = COALESCE(excluded.track_name, planner_iracing_subsessions.track_name),
       series_name = COALESCE(excluded.series_name, planner_iracing_subsessions.series_name),
       start_time = COALESCE(excluded.start_time, planner_iracing_subsessions.start_time),
       ingested_at = excluded.ingested_at,
       track_temp = COALESCE(excluded.track_temp, planner_iracing_subsessions.track_temp),
       air_temp = COALESCE(excluded.air_temp, planner_iracing_subsessions.air_temp),
       track_state = COALESCE(excluded.track_state, planner_iracing_subsessions.track_state),
       time_of_day = COALESCE(excluded.time_of_day, planner_iracing_subsessions.time_of_day)`
  )
    .bind(
      subsessionId,
      opts.leagueId ?? null,
      opts.eventId ?? null,
      header.track_name ?? null,
      header.series_name ?? null,
      header.start_time ?? null,
      now,
      conditions.trackTempC ?? null,
      conditions.airTempC ?? null,
      conditions.trackState ?? null,
      conditions.timeOfDay ?? null
    )
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

  const allJobs: Array<{ custId: string; teamId: string | null; carId: number | null; simsessionNumber: number; type: "qualifying" | "race" }> = [];
  for (const sess of simSessions) {
    for (const participant of sess.participants) {
      allJobs.push({
        custId: participant.custId,
        teamId: participant.teamId,
        carId: participant.carId,
        simsessionNumber: sess.simsessionNumber,
        type: sess.type,
      });
    }
  }

  if (allJobs.length === 0) {
    throw new PlannerIngestError(
      "no_participants",
      `Found ${simSessions.length} sim-session(s) but no participant cust_ids in them. Blocks seen: ${describeSimSessionBlocks(resultPayload)}`
    );
  }

  const doneRows = await DB.prepare(
    `SELECT DISTINCT cust_id as custId, simsession_number as simsessionNumber FROM planner_iracing_laps WHERE subsession_id = ?`
  )
    .bind(subsessionId)
    .all<{ custId: string; simsessionNumber: number }>();
  const doneKeys = new Set((doneRows.results ?? []).map((r) => `${r.custId}:${r.simsessionNumber}`));

  let pendingJobs = allJobs.filter((j) => !doneKeys.has(`${j.custId}:${j.simsessionNumber}`));
  if (opts.priorityCustId) {
    const priority = opts.priorityCustId;
    pendingJobs = [...pendingJobs.filter((j) => j.custId === priority), ...pendingJobs.filter((j) => j.custId !== priority)];
  }
  const jobs = pendingJobs.slice(0, maxJobsPerRun);
  const unattemptedJobs = pendingJobs.length - jobs.length;

  let processed = 0;
  const outcomes = await runWithConcurrency(jobs, concurrency, async (job) => {
    if (processed > 0 && delayMs > 0) await sleep(delayMs);
    processed += 1;

    const payload = await fetchLapData(subsessionId, job.custId, job.simsessionNumber, accessToken!, job.teamId);
    const rows = await extractLapRows(payload);
    const sample =
      rows.length === 0
        ? `GET ${buildLapDataPath(subsessionId, job.custId, job.simsessionNumber, job.teamId)} -> ${JSON.stringify(payload).slice(0, 700)}`
        : undefined;
    const statements: any[] = [];

    for (const row of rows) {
      const lapNumber = extractLapNumber(row);
      if (lapNumber === undefined) continue;

      const lapTimeMs = normalizeLapTimeMs(row);
      const { isPitLap, isClean, flagsRaw, flagsDecoded } = classifyLap(row);

      statements.push(
        DB.prepare(
          `INSERT INTO planner_iracing_laps (
             subsession_id, cust_id, simsession_number, simsession_type, lap_number,
             lap_time_ms, flags_raw, flags_decoded, is_pit_lap, is_clean, car_id, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(subsession_id, cust_id, simsession_number, lap_number) DO UPDATE SET
             lap_time_ms = excluded.lap_time_ms,
             flags_raw = excluded.flags_raw,
             flags_decoded = excluded.flags_decoded,
             is_pit_lap = excluded.is_pit_lap,
             is_clean = excluded.is_clean,
             car_id = COALESCE(excluded.car_id, planner_iracing_laps.car_id)`
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
          job.carId,
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
      safeLog("warn", debugId, "planner.ingest.driver_lap_fetch_failed", {
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

  const remainingJobs = unattemptedJobs + driverFailures.length;
  const fullyDone = remainingJobs === 0;
  if (fullyDone) {
    await DB.prepare(`UPDATE planner_iracing_subsessions SET laps_complete = 1 WHERE subsession_id = ?`).bind(subsessionId).run();
  }

  safeLog("log", debugId, "planner.ingest.ok", {
    subsessionId,
    lapsIngested,
    driverFailures: driverFailures.length,
    remainingJobs,
    fullyDone,
  });

  return {
    ok: true,
    subsessionId,
    trackName: header.track_name ?? undefined,
    simSessionsIngested: simSessionsSeen.size,
    driversIngested: driverNames.size,
    lapsIngested,
    driverFailures,
    emptyLapPayloadSample,
    totalJobs: allJobs.length,
    remainingJobs,
  };
}
