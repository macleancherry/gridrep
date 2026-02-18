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

function extractParticipants(payload: any): Array<{
  iracing_member_id: string;
  display_name: string;
  finish_pos?: number;
  car_name?: string;
}> {
  const candidates: any[] = [];

  if (Array.isArray(payload?.session_results)) {
    for (const sr of payload.session_results) {
      if (Array.isArray(sr?.results)) candidates.push(sr.results);
      if (Array.isArray(sr?.result_rows)) candidates.push(sr.result_rows);
      if (Array.isArray(sr?.rows)) candidates.push(sr.rows);
    }
  }

  if (Array.isArray(payload?.results)) candidates.push(payload.results);
  if (Array.isArray(payload?.result_rows)) candidates.push(payload.result_rows);
  if (Array.isArray(payload?.rows)) candidates.push(payload.rows);

  const rows = candidates.find((arr) => Array.isArray(arr) && arr.length > 0) ?? [];

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

    out.push({
      iracing_member_id: String(cust),
      display_name: name,
      finish_pos: pickNumber((r as any).finish_position ?? (r as any).finish_pos),
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
    sample: participants.slice(0, 3).map((p) => ({ id: p.iracing_member_id, name: p.display_name, pos: p.finish_pos })),
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

  for (const p of participants) {
    await DB.prepare(
      `
      INSERT INTO drivers (iracing_member_id, display_name)
      VALUES (?, ?)
      ON CONFLICT(iracing_member_id) DO UPDATE SET
        display_name = excluded.display_name
      `
    )
      .bind(p.iracing_member_id, p.display_name)
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
