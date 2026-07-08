import { getViewer, getValidAccessToken } from "./auth";
import {
  fetchSubsessionResult,
  fetchLapData,
  identifySimSessions,
  extractDriverNames,
  extractSessionHeader,
  extractLapRows,
  extractLapNumber,
  normalizeLapTimeMs,
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
};

export type IngestSummary = {
  ok: true;
  subsessionId: string;
  simSessionsIngested: number;
  driversIngested: number;
  lapsIngested: number;
  driverFailures: Array<{ custId: string; simsessionNumber: number; message: string }>;
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

  safeLog("log", debugId, "pace.ingest.start", { subsessionId });

  let resultPayload: any;
  try {
    resultPayload = await fetchSubsessionResult(subsessionId, accessToken);
  } catch (err: any) {
    safeLog("error", debugId, "pace.ingest.result_fetch_failed", {
      subsessionId,
      message: err?.message ?? String(err),
    });
    throw new PaceIngestError("iracing_fetch_failed", "Failed to fetch subsession result from iRacing.");
  }

  const header = extractSessionHeader(resultPayload);
  const simSessions = identifySimSessions(resultPayload);
  const driverNames = extractDriverNames(resultPayload);

  if (simSessions.length === 0) {
    throw new PaceIngestError("no_sim_sessions", "No qualifying or race sim-sessions found for this subsession.");
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

  await DB.prepare(`DELETE FROM pace_laps WHERE subsession_id = ?`).bind(subsessionId).run();

  const concurrency = Math.max(1, Math.min(5, opts.lapFetchConcurrency ?? 2));
  const delayMs = Math.max(0, Math.min(5000, opts.lapFetchDelayMs ?? 400));

  const driverFailures: IngestSummary["driverFailures"] = [];
  let lapsIngested = 0;

  const jobs: Array<{ custId: string; simsessionNumber: number; type: "qualifying" | "race" }> = [];
  for (const sess of simSessions) {
    for (const custId of sess.custIds) {
      jobs.push({ custId, simsessionNumber: sess.simsessionNumber, type: sess.type });
    }
  }

  let processed = 0;
  const outcomes = await runWithConcurrency(jobs, concurrency, async (job) => {
    if (processed > 0 && delayMs > 0) await sleep(delayMs);
    processed += 1;

    const payload = await fetchLapData(subsessionId, job.custId, job.simsessionNumber, accessToken!);
    const rows = extractLapRows(payload);
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
    return statements.length;
  });

  let simSessionsSeen = new Set<number>();
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const job = jobs[i];
    if (outcome.ok) {
      lapsIngested += outcome.value as number;
      simSessionsSeen.add(job.simsessionNumber);
    } else {
      const err: any = outcome.error;
      safeLog("warn", debugId, "pace.ingest.driver_lap_fetch_failed", {
        subsessionId,
        custId: job.custId,
        simsessionNumber: job.simsessionNumber,
        message: err?.message ?? String(err),
      });
      driverFailures.push({
        custId: job.custId,
        simsessionNumber: job.simsessionNumber,
        message: err?.message ?? String(err),
      });
    }
  }

  safeLog("log", debugId, "pace.ingest.ok", {
    subsessionId,
    lapsIngested,
    driverFailures: driverFailures.length,
  });

  return {
    ok: true,
    subsessionId,
    simSessionsIngested: simSessionsSeen.size,
    driversIngested: driverNames.size,
    lapsIngested,
    driverFailures,
  };
}
