import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { iracingDataGet } from "../../../../_lib/iracing";

type ResultRow = {
  cust_id?: number | string;
  display_name?: string;
  name?: string;
  finish_position?: number;
  finish_pos?: number;
  car_name?: string;
  car?: string;
  simsession_type?: number;
  simsession_type_name?: string;
  simsession_name?: string;
};

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  // Never include tokens in logs
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

function pickString(v: any): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  return undefined;
}

function pickNumber(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function pickRows(sr: any): any[] {
  if (Array.isArray(sr?.results)) return sr.results;
  if (Array.isArray(sr?.result_rows)) return sr.result_rows;
  if (Array.isArray(sr?.rows)) return sr.rows;
  return [];
}

/**
 * Choose the RACE result block from iRacing payloads.
 * iRacing /data/results/get returns session_results for practice/quali/race etc.
 * We MUST pick the race block, otherwise positions can show as practice/quali.
 */
function extractParticipants(payload: any): Array<{
  iracing_member_id: string;
  display_name: string;
  finish_pos?: number;
  car_name?: string;
}> {
  let rows: any[] = [];

  if (Array.isArray(payload?.session_results)) {
    // Prefer explicit "RACE" by name
    const raceByName = payload.session_results.find(
      (sr: any) => typeof sr?.simsession_type_name === "string" && sr.simsession_type_name.toUpperCase() === "RACE"
    );

    // Common iRacing enum: race is often 6 (but not guaranteed)
    const raceByEnum = payload.session_results.find((sr: any) => sr?.simsession_type === 6);

    // Fallback: any simsession_name containing "race"
    const raceByFuzzy = payload.session_results.find(
      (sr: any) => typeof sr?.simsession_name === "string" && /race/i.test(sr.simsession_name)
    );

    const chosen = raceByName ?? raceByEnum ?? raceByFuzzy;

    if (chosen) rows = pickRows(chosen);

    // Final fallback: first non-empty block
    if (!rows.length) {
      for (const sr of payload.session_results) {
        const r = pickRows(sr);
        if (r.length) {
          rows = r;
          break;
        }
      }
    }
  }

  // Some endpoints may return data directly at top-level (rare)
  if (!rows.length) {
    if (Array.isArray(payload?.results)) rows = payload.results;
    else if (Array.isArray(payload?.result_rows)) rows = payload.result_rows;
    else if (Array.isArray(payload?.rows)) rows = payload.rows;
  }

  const out: Array<{
    iracing_member_id: string;
    display_name: string;
    finish_pos?: number;
    car_name?: string;
  }> = [];

  for (const r of rows as ResultRow[]) {
    const cust = pickNumber((r as any).cust_id ?? (r as any).id);
    const name =
      pickString((r as any).display_name) ?? pickString((r as any).name) ?? (cust ? `Driver ${cust}` : undefined);

    if (!cust || !name) continue;

    // iRacing positions appear 0-based in some payloads (winner = 0)
    const rawPos = pickNumber((r as any).finish_position ?? (r as any).finish_pos);
    const finishPos = typeof rawPos === "number" ? rawPos + 1 : undefined;

    out.push({
      iracing_member_id: String(cust),
      display_name: name,
      finish_pos: finishPos,
      car_name: pickString((r as any).car_name) ?? pickString((r as any).car),
    });
  }

  return out;
}

function extractSessionHeader(payload: any): { start_time?: string; series_name?: string; track_name?: string } {
  const start =
    pickString(payload?.start_time) ??
    pickString(payload?.subsession_start_time) ??
    pickString(payload?.session_start_time) ??
    pickString(payload?.startTime);

  const series =
    pickString(payload?.series_name) ??
    pickString(payload?.series?.series_name) ??
    pickString(payload?.event_name) ??
    pickString(payload?.seriesName);

  const track =
    pickString(payload?.track_name) ??
    pickString(payload?.track?.track_name) ??
    pickString(payload?.track?.track_name_full) ??
    pickString(payload?.trackName);

  return { start_time: start, series_name: series, track_name: track };
}

function isScopeRequiredError(err: any): boolean {
  const name = (err?.name ?? "").toString();
  const code = (err?.code ?? "").toString();
  const msg = (err?.message ?? "").toString().toLowerCase();
  const raw = (err?.raw ?? "").toString().toLowerCase();

  if (name === "IRacingScopeRequiredError") return true;
  if (code === "scope_required") return true;

  return (
    (msg.includes("iracing.auth") && msg.includes("required")) ||
    (raw.includes("iracing.auth") && raw.includes("required"))
  );
}

function jsonError(status: number, payload: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

type ImportOpts = {
  // If provided, we won't call getViewer/getValidAccessToken again.
  viewerUserId?: string;
  accessToken?: string;
};

/**
 * Shared importer: can be called from /api/sessions/:id (automatic import)
 */
export async function importSubsessionToCache(context: any, subsessionId: string, opts?: ImportOpts) {
  const debugId = crypto.randomUUID();
  const { DB } = context.env;

  safeLog("log", debugId, "session.import.start", { subsessionId });

  // NEW: Skip if this subsession is already cached (has any participants)
  const existing = await DB.prepare(
    `SELECT 1 as ok
     FROM session_participants
     WHERE iracing_session_id = ?
     LIMIT 1`
  )
    .bind(subsessionId)
    .first<any>();

  if (existing?.ok) {
    safeLog("log", debugId, "session.import.skip_already_cached", { subsessionId });
    return { ok: true, subsessionId, participantsImported: 0, debugId, skipped: true };
  }

  // If called from recent/import, we can avoid repeated auth/db work.
  let viewerUserId = opts?.viewerUserId;
  let accessToken = opts?.accessToken;

  if (!viewerUserId || !accessToken) {
    const viewer = await getViewer(context);
    if (!viewer.verified) {
      safeLog("warn", debugId, "session.import.not_verified", { subsessionId });
      const e: any = new Error("Not verified");
      e.code = "not_verified";
      e.debugId = debugId;
      throw e;
    }

    viewerUserId = viewer.user!.id;

    try {
      accessToken = await getValidAccessToken(context, viewerUserId);
    } catch (err: any) {
      safeLog("warn", debugId, "session.import.access_token_failed", {
        subsessionId,
        message: err?.message ?? String(err),
      });
      const e: any = new Error("Authentication required");
      e.code = "auth_required";
      e.debugId = debugId;
      throw e;
    }
  }

  let payload: any;
  try {
    payload = await iracingDataGet<any>(
      `/data/results/get?subsession_id=${encodeURIComponent(subsessionId)}&include_licenses=false`,
      accessToken!
    );
  } catch (err: any) {
    if (isScopeRequiredError(err)) {
      safeLog("warn", debugId, "session.import.scope_required", { subsessionId });
      const e: any = new Error("The iracing.auth scope is required for this request.");
      e.code = "scope_required";
      e.debugId = debugId;
      throw e;
    }

    safeLog("error", debugId, "session.import.iracing_fetch_failed", {
      subsessionId,
      name: err?.name ?? null,
      code: err?.code ?? null,
      status: err?.status ?? null,
      message: err?.message ?? String(err),
    });

    const e: any = new Error("Failed to fetch iRacing results");
    e.code = "iracing_fetch_failed";
    e.debugId = debugId;
    throw e;
  }

  const header = extractSessionHeader(payload);
  const participants = extractParticipants(payload);

  safeLog("log", debugId, "session.import.parsed", {
    subsessionId,
    participantCount: participants.length,
  });

  // --- DB writes (batched + transaction) ---
  const now = new Date().toISOString();
  const statements: any[] = [];

  statements.push(DB.prepare("BEGIN"));

  statements.push(
    DB.prepare(
      `
      INSERT INTO sessions (iracing_session_id, start_time, series_name, track_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(iracing_session_id) DO UPDATE SET
        start_time = COALESCE(excluded.start_time, sessions.start_time),
        series_name = COALESCE(excluded.series_name, sessions.series_name),
        track_name = COALESCE(excluded.track_name, sessions.track_name)
      `
    ).bind(subsessionId, header.start_time ?? null, header.series_name ?? null, header.track_name ?? null)
  );

  // Idempotent: replace participants
  statements.push(DB.prepare(`DELETE FROM session_participants WHERE iracing_session_id = ?`).bind(subsessionId));

  for (const p of participants) {
    statements.push(
      DB.prepare(
        `
        INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(iracing_member_id) DO UPDATE SET
          display_name = excluded.display_name,
          last_seen_at = excluded.last_seen_at
        `
      ).bind(p.iracing_member_id, p.display_name, now)
    );

    statements.push(
      DB.prepare(
        `
        INSERT INTO session_participants (iracing_session_id, iracing_member_id, finish_pos, car_name)
        VALUES (?, ?, ?, ?)
        `
      ).bind(subsessionId, p.iracing_member_id, p.finish_pos ?? null, p.car_name ?? null)
    );
  }

  statements.push(DB.prepare("COMMIT"));

  try {
    await DB.batch(statements);
  } catch (e: any) {
    try {
      await DB.prepare("ROLLBACK").run();
    } catch {}
    safeLog("error", debugId, "session.import.db_failed", {
      subsessionId,
      message: e?.message ?? String(e),
    });
    const err: any = new Error("Database write failed");
    err.code = "db_failed";
    err.debugId = debugId;
    throw err;
  }

  safeLog("log", debugId, "session.import.ok", { subsessionId, participantsImported: participants.length });

  return { ok: true, subsessionId, participantsImported: participants.length, debugId };
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const debugId = crypto.randomUUID();

  try {
    const result = await importSubsessionToCache(context, subsessionId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const code = (err?.code ?? "").toString();
    const errDebugId = (err?.debugId ?? debugId).toString();

    if (code === "not_verified" || (err?.message ?? "") === "Not verified") {
      return jsonError(
        401,
        {
          error: "not_verified",
          message: "Verification required to import uncached sessions.",
          debugId: errDebugId,
        },
        { "X-GridRep-Debug-Id": errDebugId }
      );
    }

    if (code === "auth_required") {
      return jsonError(
        401,
        {
          error: "auth_required",
          message: "Please verify again to continue.",
          debugId: errDebugId,
        },
        { "X-GridRep-Debug-Id": errDebugId }
      );
    }

    if (code === "scope_required" || isScopeRequiredError(err)) {
      return jsonError(
        403,
        {
          error: "missing_required_scope",
          message:
            "Your iRacing account did not grant iracing.auth (often because the subscription is inactive). Please renew/activate your iRacing subscription and verify again.",
          debugId: errDebugId,
        },
        { "X-GridRep-Debug-Id": errDebugId }
      );
    }

    safeLog("error", errDebugId, "session.import.unhandled_error", {
      subsessionId,
      name: err?.name ?? null,
      code: err?.code ?? null,
      status: err?.status ?? null,
      message: err?.message ?? String(err),
    });

    return jsonError(
      500,
      {
        error: "import_failed",
        message: "Import failed. Please try again.",
        debugId: errDebugId,
      },
      { "X-GridRep-Debug-Id": errDebugId }
    );
  }
}