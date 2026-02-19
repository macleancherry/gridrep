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
    // Helpful for debugging: see what's inside session_results
    try {
      console.log(
        "session_results overview (safe)",
        payload.session_results.map((sr: any, i: number) => ({
          i,
          simsession_type: sr?.simsession_type,
          simsession_type_name: sr?.simsession_type_name,
          simsession_name: sr?.simsession_name,
          rows: pickRows(sr).length,
        }))
      );
    } catch {
      // ignore logging failures
    }

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
      pickString((r as any).display_name) ??
      pickString((r as any).name) ??
      (cust ? `Driver ${cust}` : undefined);

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

/**
 * Shared importer: can be called from /api/sessions/:id (automatic import)
 */
export async function importSubsessionToCache(context: any, subsessionId: string) {
  const { DB } = context.env;

  const viewer = await getViewer(context);
  if (!viewer.verified) throw new Error("Not verified");

  const accessToken = await getValidAccessToken(context, viewer.user!.id);

  const payload = await iracingDataGet<any>(
    `/data/results/get?subsession_id=${encodeURIComponent(subsessionId)}&include_licenses=false`,
    accessToken
  );

  console.log("iRacing results/get payload (safe)", {
    subsessionId,
    topKeys: payload ? Object.keys(payload).slice(0, 20) : [],
    hasSessionResults: Array.isArray(payload?.session_results),
  });

  const header = extractSessionHeader(payload);
  const participants = extractParticipants(payload);

  console.log("Import parsed (safe)", {
    subsessionId,
    participantCount: participants.length,
    sample: participants.slice(0, 3).map((p) => ({
      id: p.iracing_member_id,
      name: p.display_name,
      pos: p.finish_pos,
    })),
  });

  await DB.prepare(
    `
    INSERT INTO sessions (iracing_session_id, start_time, series_name, track_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(iracing_session_id) DO UPDATE SET
      start_time = COALESCE(excluded.start_time, sessions.start_time),
      series_name = COALESCE(excluded.series_name, sessions.series_name),
      track_name = COALESCE(excluded.track_name, sessions.track_name)
    `
  )
    .bind(subsessionId, header.start_time ?? null, header.series_name ?? null, header.track_name ?? null)
    .run();

  // Idempotent: replace participants
  await DB.prepare(`DELETE FROM session_participants WHERE iracing_session_id = ?`).bind(subsessionId).run();

  // drivers.last_seen_at is NOT NULL in your schema
  const now = new Date().toISOString();

  for (const p of participants) {
    await DB.prepare(
      `
      INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT(iracing_member_id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at
      `
    )
      .bind(p.iracing_member_id, p.display_name, now)
      .run();

    await DB.prepare(
      `
      INSERT INTO session_participants (iracing_session_id, iracing_member_id, finish_pos, car_name)
      VALUES (?, ?, ?, ?)
      `
    )
      .bind(subsessionId, p.iracing_member_id, p.finish_pos ?? null, p.car_name ?? null)
      .run();
  }

  return { ok: true, subsessionId, participantsImported: participants.length };
}

export async function onRequestGet(context: any) {
  const subsessionId = context.params.subsessionId as string;
  const result = await importSubsessionToCache(context, subsessionId);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
